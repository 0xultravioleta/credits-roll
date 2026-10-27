import type { Viewer } from '../domain.js';
import { object, text, validLogin } from './source.js';
import type { TwitchApi } from './helix.js';
import { TwitchApiError } from './helix.js';

export interface Reward {
  id: string;
  title: string;
}
export interface Redemption {
  id: string;
  rewardId: string;
  broadcasterId: string;
  viewer: Viewer;
  status: 'unfulfilled' | 'fulfilled' | 'canceled';
}
export interface ChannelApi {
  rewards(channel: string): Promise<Reward[]>;
  createReward(channel: string, prize: string, enabled?: boolean): Promise<Reward>;
  updateReward(channel: string, id: string, enabled: boolean, prize: string): Promise<void>;
  redemptions(channel: string, reward: string): Promise<Redemption[]>;
  settle(
    channel: string,
    reward: string,
    id: string,
    status: 'FULFILLED' | 'CANCELED',
  ): Promise<void>;
  send(channel: string, sender: string, message: string, replyTo?: string): Promise<void>;
  stream(channel: string): Promise<string>;
}
export function parseRedemption(value: unknown): Redemption | undefined {
  const row = object(value);
  const reward = object(row.reward);
  const status = String(row.status).toLowerCase();
  if (
    !text(row.id, 128) ||
    !text(reward.id, 128) ||
    !text(row.broadcaster_user_id, 128) ||
    !text(row.user_id, 128) ||
    !validLogin(row.user_login) ||
    !['unfulfilled', 'fulfilled', 'canceled'].includes(status)
  )
    return undefined;
  return {
    id: row.id,
    rewardId: reward.id,
    broadcasterId: row.broadcaster_user_id,
    viewer: { id: row.user_id, login: row.user_login },
    status: status as Redemption['status'],
  };
}
function rows(value: unknown): unknown[] {
  const data = object(value).data;
  if (!Array.isArray(data)) throw new Error('Invalid Twitch response');
  return data;
}
function reward(value: unknown): Reward {
  const row = object(value);
  if (!text(row.id, 128) || !text(row.title, 100)) throw new Error('Invalid reward response');
  return { id: row.id, title: row.title };
}
export class TwitchChannelApi implements ChannelApi {
  constructor(private readonly api: TwitchApi) {}
  async rewards(channel: string): Promise<Reward[]> {
    return rows(
      await this.api.request('streamer', 'channel_points/custom_rewards', {
        query: { broadcaster_id: channel, only_manageable_rewards: 'true' },
      }),
    ).map(reward);
  }
  async createReward(channel: string, prize: string, enabled = false): Promise<Reward> {
    return reward(
      rows(
        await this.api.request('streamer', 'channel_points/custom_rewards', {
          method: 'POST',
          query: { broadcaster_id: channel },
          body: {
            title: 'Enter the Credits Wheel',
            cost: 100,
            prompt: prize,
            is_enabled: enabled,
            is_user_input_required: false,
            should_redemptions_skip_request_queue: false,
            is_max_per_user_per_stream_enabled: true,
            max_per_user_per_stream: 1,
          },
        }),
      )[0],
    );
  }
  async updateReward(channel: string, id: string, enabled: boolean, prize: string): Promise<void> {
    await this.api.request('streamer', 'channel_points/custom_rewards', {
      method: 'PATCH',
      query: { broadcaster_id: channel, id },
      body: { is_enabled: enabled, prompt: prize },
    });
  }
  async redemptions(channel: string, rewardId: string): Promise<Redemption[]> {
    const all: Redemption[] = [];
    let after = '';
    do {
      const result = await this.api.request(
        'streamer',
        'channel_points/custom_rewards/redemptions',
        {
          query: {
            broadcaster_id: channel,
            reward_id: rewardId,
            status: 'UNFULFILLED',
            first: '50',
            ...(after ? { after } : {}),
          },
        },
      );
      for (const row of rows(result)) {
        const item = parseRedemption(row);
        if (!item) throw new Error('Invalid redemption response');
        all.push(item);
      }
      const cursor = object(object(result).pagination).cursor;
      after = typeof cursor === 'string' ? cursor : '';
      if (all.length > 10_000)
        throw new Error('Too many queued redemptions; review the reward in Twitch');
    } while (after);
    return all;
  }
  async settle(
    channel: string,
    rewardId: string,
    id: string,
    status: 'FULFILLED' | 'CANCELED',
  ): Promise<void> {
    const query = { broadcaster_id: channel, reward_id: rewardId, id };
    try {
      await this.api.request('streamer', 'channel_points/custom_rewards/redemptions', {
        method: 'PATCH',
        query,
        body: { status },
      });
    } catch (error) {
      if (!(error instanceof TwitchApiError) || error.status !== 400) throw error;
      const existing = object(
        rows(
          await this.api.request('streamer', 'channel_points/custom_rewards/redemptions', {
            query,
          }),
        )[0],
      );
      if (existing.status !== status) throw error;
    }
  }
  async send(channel: string, sender: string, message: string, replyTo?: string): Promise<void> {
    const result = object(
      rows(
        await this.api.request('bot', 'chat/messages', {
          method: 'POST',
          body: {
            broadcaster_id: channel,
            sender_id: sender,
            message,
            ...(replyTo ? { reply_parent_message_id: replyTo } : {}),
          },
        }),
      )[0],
    );
    if (result.is_sent !== true) throw new Error('Twitch did not send the announcement');
  }
  async stream(channel: string): Promise<string> {
    const id = await this.liveStream(channel);
    if (!id) throw new Error('The channel must be live before listening');
    return id;
  }
  async broadcasterType(channel: string): Promise<'' | 'affiliate' | 'partner'> {
    const result = object(
      rows(await this.api.request('streamer', 'users', { query: { id: channel } }))[0],
    );
    if (
      result.id !== channel ||
      !['', 'affiliate', 'partner'].includes(String(result.broadcaster_type))
    )
      throw new Error('Invalid Twitch channel profile');
    return result.broadcaster_type as '' | 'affiliate' | 'partner';
  }
  async liveStream(channel: string): Promise<string | null> {
    const data = rows(
      await this.api.request('streamer', 'streams', { query: { user_id: channel } }),
    );
    if (!data.length) return null;
    const result = object(data[0]);
    if (!text(result.id, 128)) throw new Error('Invalid Twitch stream response');
    return result.id;
  }
}
