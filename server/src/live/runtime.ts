import type { OAuthAccounts } from '../auth/oauth.js';
import type { Transcriber } from '../ai/interfaces.js';
import type { DashboardActions, Settings } from '../dashboard/state.js';
import { DashboardState } from '../dashboard/state.js';
import { OverlayHub } from '../events/hub.js';
import { Pipeline } from '../pipeline.js';
import { Store } from '../store/index.js';
import { Helix } from '../twitch/helix.js';
import { TwitchChannelApi } from '../twitch/channel-api.js';
import { QuietBot } from '../twitch/bot.js';
import { LiveChatSource } from '../twitch/live.js';
import { LiveTranscriptSource } from '../transcript/live.js';
import { ProcessAudioRunner } from '../transcript/runner.js';
import { WheelService } from '../wheel/service.js';
import { ListeningSession } from './session.js';

export class LiveRuntime {
  private readonly session: ListeningSession;
  private services?: {
    key: string;
    api: TwitchChannelApi;
    helix: Helix;
    bot: QuietBot;
    wheel: WheelService;
  };
  private finishing?: Promise<{ ok: boolean }>;
  private readonly unsubscribe?: () => void;
  constructor(
    private readonly options: {
      accounts?: OAuthAccounts;
      store: Store;
      dashboard: DashboardState;
      hub: OverlayHub;
      pipeline: Pipeline;
      enabled: boolean;
      apiKeyPresent: boolean;
      transcriber: Transcriber;
      audioDelay: number;
    },
  ) {
    this.session = new ListeningSession({
      enabled: options.enabled,
      accounts: options.accounts,
      dashboard: options.dashboard,
      hub: options.hub,
      pipeline: options.pipeline,
      stream: async () => {
        const { api } = this.getServices();
        const channel = options.accounts!.identity('streamer')!.id;
        const stream = await api.stream(channel);
        options.store.setSetting(`last-stream:${channel}`, stream);
        return stream;
      },
      chat: (config) =>
        new LiveChatSource(config, fetch, {
          subscribe: async (sessionId, signal) => {
            await this.getServices().helix.request('bot', 'eventsub/subscriptions', {
              method: 'POST',
              signal,
              body: {
                type: 'channel.chat.message',
                version: '1',
                condition: { broadcaster_user_id: config.broadcasterId, user_id: config.userId },
                transport: { method: 'websocket', session_id: sessionId },
              },
            });
          },
        }),
      transcript: (streamId, channel) =>
        new LiveTranscriptSource({
          streamId,
          channel,
          apiKeyPresent: options.apiKeyPresent,
          transcriber: options.transcriber,
          runner: new ProcessAudioRunner(),
          delayMs: options.audioDelay,
          language: () => options.dashboard.getSettings().language,
          status: (message) => options.dashboard.setStatus(message),
        }),
      events: async () => {
        const accounts = options.accounts!;
        const channel = accounts.identity('streamer')!.id;
        const { helix, wheel } = this.getServices();
        return new LiveChatSource(
          {
            clientId: accounts.config.clientId,
            accessToken: await accounts.accessToken('streamer'),
            broadcasterId: channel,
            userId: channel,
          },
          fetch,
          {
            subscribe: async (sessionId, signal) => {
              for (const type of [
                'stream.offline',
                'channel.channel_points_custom_reward_redemption.add',
              ])
                await helix.request('streamer', 'eventsub/subscriptions', {
                  method: 'POST',
                  signal,
                  body: {
                    type,
                    version: '1',
                    condition: { broadcaster_user_id: channel },
                    transport: { method: 'websocket', session_id: sessionId },
                  },
                });
              await wheel.reconcile();
            },
            onEvent: (event) => {
              if (event.type === 'redemption') return wheel.redemption(event.redemption);
              if (event.type === 'offline')
                void this.finish().catch(() =>
                  options.dashboard.setStatus(
                    'Stream ended. Retry Roll credits after checking Twitch authorization.',
                  ),
                );
            },
          },
        );
      },
      onStart: () => this.getServices().wheel.configure(options.dashboard.getSettings()),
      onStop: async () => {
        if (this.services) await this.services.wheel.pause();
      },
      onAuthorizationLost: () => this.handleRevocation(),
    });
    this.unsubscribe = options.accounts?.onRevoked(() => this.handleRevocation());
  }
  private getServices() {
    const accounts = this.options.accounts;
    const streamer = accounts?.identity('streamer');
    const sender = accounts?.identity('bot');
    if (!accounts || !streamer || !sender) throw new Error('Connect streamer and bot accounts');
    const key = `${streamer.id}:${sender.id}`;
    if (this.services?.key !== key) {
      this.services?.bot.close();
      const helix = new Helix(accounts);
      const api = new TwitchChannelApi(helix);
      const bot = new QuietBot({
        channel: streamer.id,
        sender: sender.id,
        api,
        store: this.options.store,
        quiet: () => this.options.dashboard.getSettings().quietMode,
      });
      const wheel = new WheelService({
        channel: streamer.id,
        api,
        store: this.options.store,
        bot,
        settings: () => this.options.dashboard.getSettings(),
        streamId: () => this.currentStreamId(),
        accepting: () => this.session.running,
      });
      this.services = { key, helix, api, bot, wheel };
    }
    return this.services;
  }
  private currentStreamId(): string {
    const channel = this.options.accounts?.identity('streamer')?.id;
    return (
      this.session.streamId ||
      (channel ? this.options.store.getSetting(`last-stream:${channel}`) : '') ||
      ''
    );
  }
  finish(): Promise<{ ok: boolean }> {
    if (this.finishing) return this.finishing;
    const operation = (async () => {
      await this.session.stop();
      const streamId = this.currentStreamId() || this.options.hub.snapshot().streamId;
      this.options.hub.rollCredits(streamId);
      if (this.options.accounts?.identity('bot') && this.currentStreamId())
        await this.getServices().bot.credits(streamId, this.options.hub.snapshot().credits);
      this.options.dashboard.setStatus(
        'Credits are rolling. Spin the wheel when entries are ready.',
      );
      return { ok: true };
    })();
    this.finishing = operation;
    void operation
      .finally(() => {
        this.finishing = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
  async privacy(viewerId: string, messageId: string): Promise<void> {
    this.options.dashboard.clearTranscripts();
    if (!this.options.accounts?.identity('streamer') || !this.options.accounts.identity('bot'))
      return;
    const { bot, wheel } = this.getServices();
    const results = await Promise.allSettled([
      wheel.refundOptOuts(),
      bot.privacy(viewerId, messageId),
    ]);
    if (results.some((result) => result.status === 'rejected'))
      this.options.dashboard.setStatus(
        'Privacy data removed. Review pending point refunds and bot delivery in Twitch.',
      );
  }
  async settingsChanged(settings: Settings): Promise<void> {
    if (settings.wheelEnabled || this.services) await this.getServices().wheel.configure(settings);
  }
  async stop(): Promise<void> {
    this.unsubscribe?.();
    try {
      await this.session.stop();
    } finally {
      this.services?.bot.close();
    }
  }
  private clearLocal(): void {
    this.options.pipeline.clearChat();
    this.options.store.clearChannelData();
    this.options.hub.reset();
    this.options.dashboard.clearTranscripts();
    this.options.dashboard.setWinner(undefined);
  }
  private async revoked(): Promise<void> {
    this.services?.bot.close();
    this.clearLocal();
    try {
      await this.session.stop();
    } catch {
      /* The revoked token cannot disable a remote reward. */
    } finally {
      this.services?.bot.close();
      this.services = undefined;
      this.session.streamId = '';
      this.options.accounts?.disconnect('bot');
      this.options.accounts?.disconnect('streamer');
      this.options.dashboard.setStatus(
        'Authorization revoked. Local channel data removed. Review pending rewards in Twitch, then reconnect.',
      );
    }
  }
  private handleRevocation(): void {
    void this.revoked().catch(() =>
      this.options.dashboard.setStatus(
        'Authorization revoked. Local data removed; review the token file and pending rewards.',
      ),
    );
  }
  readonly actions: DashboardActions = {
    start: () => this.session.start(),
    stop: () => this.session.stop(),
    settingsChanged: (settings) => this.settingsChanged(settings),
    rollCredits: () => this.finish(),
    spinWheel: async () => {
      const result = await this.getServices().wheel.spin();
      this.options.dashboard.setWinner(result.winner?.viewer);
      return result;
    },
    disconnect: async () => {
      try {
        await this.session.stop();
        if (this.services)
          await this.services.wheel.configure({
            ...this.options.dashboard.getSettings(),
            wheelEnabled: false,
          });
      } finally {
        this.clearLocal();
        this.services?.bot.close();
        this.services = undefined;
        this.session.streamId = '';
        this.options.accounts?.disconnect('bot');
        this.options.accounts?.disconnect('streamer');
        this.options.dashboard.clearTranscripts();
      }
    },
  };
}
