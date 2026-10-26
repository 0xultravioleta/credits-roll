import { randomUUID } from 'node:crypto';
import { Store } from '../store/index.js';
import type { WheelRedemption } from '../store/index.js';
import { drawWheel, wheelWeight } from '../scoring/index.js';
import type { WheelEntry } from '../scoring/index.js';
import type { Settings } from '../dashboard/state.js';
import type { ChannelApi, Redemption } from '../twitch/channel-api.js';
import { QuietBot } from '../twitch/bot.js';

export class WheelService {
  private queue = Promise.resolve();
  private rewardId?: string;
  constructor(
    private readonly options: {
      channel: string;
      api: ChannelApi;
      store: Store;
      bot: QuietBot;
      settings: () => Settings;
      streamId: () => string;
      random?: () => number;
      accepting?: () => boolean;
    },
  ) {
    this.rewardId = options.store.getSetting(`reward:${options.channel}`);
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  configure(settings: Settings): Promise<void> {
    return this.serial(async () => {
      if (!settings.wheelEnabled && !this.rewardId) return;
      const enabled =
        settings.wheelEnabled &&
        (this.options.accepting?.() ?? true) &&
        !!this.options.streamId() &&
        !this.options.store.wheelRound(this.options.channel, this.options.streamId());
      if (!this.rewardId) {
        const existing = (await this.options.api.rewards(this.options.channel)).find(
          (reward) => reward.title === 'Enter the Credits Wheel',
        );
        const reward =
          existing ??
          (await this.options.api.createReward(this.options.channel, settings.prizeText, enabled));
        this.rewardId = reward.id;
        this.options.store.setSetting(`reward:${this.options.channel}`, reward.id);
      }
      await this.options.api.updateReward(
        this.options.channel,
        this.rewardId,
        enabled,
        settings.prizeText,
      );
      if (!settings.wheelEnabled) {
        for (const entry of this.options.store
          .redemptions(this.options.channel)
          .filter((entry) => entry.status === 'queued'))
          await this.settle(entry, 'canceled');
      }
    });
  }
  reconcile(): Promise<void> {
    return this.serial(async () => {
      if (!this.rewardId) return;
      for (const item of await this.options.api.redemptions(this.options.channel, this.rewardId))
        await this.receive(item, true);
    });
  }
  redemption(item: Redemption): Promise<void> {
    return this.serial(() => this.receive(item));
  }
  private async receive(item: Redemption, recovered = false): Promise<void> {
    if (
      item.broadcasterId !== this.options.channel ||
      item.rewardId !== this.rewardId ||
      item.status !== 'unfulfilled'
    )
      return;
    const store = this.options.store;
    const streamId = this.options.streamId();
    const prior = store.redemptions(this.options.channel).find((entry) => entry.id === item.id);
    if (prior) {
      if (prior.target_status) await this.settle(prior, prior.target_status);
      else if (prior.status === 'canceled' || prior.status === 'fulfilled')
        await this.options.api.settle(
          item.broadcasterId,
          item.rewardId,
          item.id,
          prior.status === 'fulfilled' ? 'FULFILLED' : 'CANCELED',
        );
      return;
    }
    store.addRedemption(item, streamId);
    const row = store.redemptions(this.options.channel).find((entry) => entry.id === item.id)!;
    const duplicate = store
      .redemptions(this.options.channel, streamId)
      .some(
        (entry) =>
          entry.id !== item.id && entry.viewer_id === item.viewer.id && entry.status !== 'canceled',
      );
    // Unknown pending redemptions on recovery may be from an earlier stream: refund conservatively.
    if (
      recovered ||
      !streamId ||
      !this.options.settings().wheelEnabled ||
      store.isOptedOut(item.viewer.id) ||
      duplicate ||
      store.wheelRound(this.options.channel, streamId)
    )
      await this.settle(row, 'canceled');
  }
  spin(): Promise<{ winner: WheelEntry | null; roundId?: string }> {
    return this.serial(async () => {
      const store = this.options.store;
      const streamId = this.options.streamId();
      let round = store.wheelRound(this.options.channel, streamId);
      if (!round) {
        const entries = this.entries();
        const winner = drawWheel(entries, this.options.random);
        if (!winner) throw new Error('The wheel has no eligible redemptions');
        round = store.prepareRound(randomUUID(), this.options.channel, streamId, winner.viewer.id);
      }
      if (round.state !== 'complete') {
        for (const entry of store
          .redemptions(this.options.channel, streamId)
          .filter((entry) => entry.round_id === round!.id && entry.status === 'queued'))
          await this.settle(
            entry,
            entry.viewer_id && !store.isOptedOut(entry.viewer_id) ? 'fulfilled' : 'canceled',
          );
        store.completeRound(round.id);
      }
      await this.pause();
      const winner = this.entry(round.winner_id);
      if (winner)
        await this.options.bot.winner(round.id, winner.viewer, this.options.settings().prizeText);
      return { winner: this.entry(round.winner_id) ?? null, roundId: round.id };
    });
  }
  async pause(): Promise<void> {
    if (this.rewardId)
      await this.options.api.updateReward(
        this.options.channel,
        this.rewardId,
        false,
        this.options.settings().prizeText,
      );
  }
  refundOptOuts(): Promise<void> {
    return this.serial(async () => {
      for (const entry of this.options.store
        .redemptions(this.options.channel)
        .filter(
          (entry) =>
            entry.status === 'queued' && !entry.viewer_id && entry.target_status === 'canceled',
        ))
        await this.settle(entry, 'canceled');
    });
  }
  entries(): WheelEntry[] {
    const ids = [
      ...new Set(
        this.options.store
          .redemptions(this.options.channel, this.options.streamId())
          .filter((entry) => entry.status === 'queued')
          .map((entry) => entry.viewer_id),
      ),
    ];
    return ids.flatMap((id) => {
      const entry = this.entry(id);
      return entry ? [entry] : [];
    });
  }
  private entry(id: string | null): WheelEntry | undefined {
    if (!id || this.options.store.isOptedOut(id)) return undefined;
    const viewer = this.options.store.getViewer(id);
    if (!viewer) return undefined;
    const reputation = this.options.store.getReputation().find((entry) => entry.viewer.id === id);
    return {
      viewer,
      points: reputation?.points ?? 0,
      momentCount: reputation?.momentCount ?? 0,
      weight: wheelWeight(reputation?.points ?? 0) || 1,
    };
  }
  private async settle(entry: WheelRedemption, status: 'fulfilled' | 'canceled'): Promise<void> {
    this.options.store.targetRedemption(entry.id, status);
    await this.options.api.settle(
      entry.broadcaster_id,
      entry.reward_id,
      entry.id,
      status === 'fulfilled' ? 'FULFILLED' : 'CANCELED',
    );
    this.options.store.settleRedemption(entry.id, status);
  }
}
