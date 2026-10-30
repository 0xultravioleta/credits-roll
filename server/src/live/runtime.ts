import type { OAuthAccounts } from '../auth/oauth.js';
import { AuthorizationRejected } from '../auth/oauth.js';
import type { Transcriber } from '../ai/interfaces.js';
import type { DashboardActions, Settings } from '../dashboard/state.js';
import { DashboardState } from '../dashboard/state.js';
import { OverlayHub } from '../events/hub.js';
import { Pipeline } from '../pipeline.js';
import { Store } from '../store/index.js';
import { Helix } from '../twitch/helix.js';
import type { TwitchApi } from '../twitch/helix.js';
import type { TwitchConfig, LiveSourceOptions } from '../twitch/live.js';
import type { ChatSource } from '../twitch/source.js';
import type { TranscriptSource } from '../transcript/source.js';
import { TwitchChannelApi } from '../twitch/channel-api.js';
import { QuietBot } from '../twitch/bot.js';
import { LiveChatSource } from '../twitch/live.js';
import { LiveTranscriptSource } from '../transcript/live.js';
import { ProcessAudioRunner } from '../transcript/runner.js';
import { WheelService } from '../wheel/service.js';
import { ListeningSession } from './session.js';
import { AutoListener } from './auto-listen.js';
import type { BroadcasterType } from '../dashboard/capabilities.js';
import { DashboardActionError } from '../dashboard/action-error.js';
import { abortableDelay } from '../runtime/time.js';
import { ClipService } from '../clips/service.js';
import { HelixClipProvider } from '../clips/provider.js';
import type { MemoryCreditLedger } from '../ledger/index.js';
import type { Moment } from '../domain.js';
import { ForecastService } from '../predictions/service.js';
import { HelixPredictionProvider } from '../predictions/provider.js';
import type { ForecastView } from '../predictions/types.js';
import { FORECAST_RULES } from '../predictions/types.js';
import { resolveStreamLanguage, transcriptionLanguage } from '../transcript/language.js';
import type { ProviderStage, ProviderReason } from '../ai/failure.js';

export class LiveRuntime {
  get running(): boolean {
    return this.session.running || this.auto.snapshot().phase === 'connecting';
  }
  private readonly session: ListeningSession;
  readonly auto: AutoListener;
  broadcasterType: BroadcasterType | null = null;
  private streamLanguage: string | null = null;
  private providerState: {
    errors: number;
    consecutive: number;
    lastStage: ProviderStage | null;
    lastReason: ProviderReason | null;
  } = {
    errors: 0,
    consecutive: 0,
    lastStage: null,
    lastReason: null,
  };
  providerStatus() {
    return { ...this.providerState };
  }
  transcriptionStatus() {
    return transcriptionLanguage(
      this.options.dashboard.getSettings().language,
      this.streamLanguage,
      this.options.transcriptionLanguage,
    );
  }
  private monitor?: AbortController;
  private monitorTask?: Promise<void>;
  private probeTimer?: ReturnType<typeof setInterval>;
  private initializing?: Promise<void>;
  private closed = false;
  private readonly shutdownController = new AbortController();
  private services?: {
    key: string;
    api: TwitchChannelApi;
    helix: TwitchApi;
    bot: QuietBot;
    wheel: WheelService;
    clips?: ClipService;
    forecast: ForecastService;
  };
  private finishing?: Promise<{ ok: boolean }>;
  private readonly unsubscribe?: () => void;
  private readonly detachClipPrivacy: () => void;
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
      transcriptionLanguage?: string;
      tools?: { streamlink: boolean | null; ffmpeg: boolean | null };
      twitchApi?: TwitchApi;
      eventSource?: (config: TwitchConfig, options: LiveSourceOptions) => ChatSource;
      chatSource?: (config: TwitchConfig) => ChatSource;
      transcriptSource?: (stream: string, channel: string, onAudio: () => void) => TranscriptSource;
      ledger?: MemoryCreditLedger;
    },
  ) {
    this.auto = new AutoListener({
      start: async (streamId) => {
        const channel = options.accounts!.identity('streamer')!.id;
        options.store.setSetting(`last-stream:${channel}`, streamId);
        await this.session.start(streamId);
      },
      stop: () => this.session.stop(),
      finish: () => this.finish(),
      probe: () => this.getServices().api.liveStream(options.accounts!.identity('streamer')!.id),
      blockReason: () => this.blockReason(),
      readPause: () => options.store.getSetting('auto-listen-paused-stream') ?? '',
      savePause: (id) => options.store.setSetting('auto-listen-paused-stream', id),
    });
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
        options.chatSource?.(config) ??
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
        options.transcriptSource?.(streamId, channel, () => this.auto.audio()) ??
        new LiveTranscriptSource({
          streamId,
          channel,
          apiKeyPresent: options.apiKeyPresent,
          transcriber: options.transcriber,
          runner: new ProcessAudioRunner(undefined, undefined, undefined, (message) =>
            options.dashboard.setStatus(message),
          ),
          delayMs: options.audioDelay,
          language: () => this.transcriptionStatus().resolved,
          status: (message) => options.dashboard.setStatus(message),
          onAudio: () => this.auto.audio(),
          onProviderFailure: (error, consecutive) => {
            this.providerState = {
              errors: this.providerState.errors + 1,
              consecutive,
              lastStage: error.stage,
              lastReason: error.reason,
            };
          },
          onProviderSuccess: () => {
            this.providerState.consecutive = 0;
          },
          startupManaged: true,
        }),
      onStart: async () => {
        this.providerState.consecutive = 0;
        this.streamLanguage = await resolveStreamLanguage(() =>
          this.getServices().api.liveStreamInfo(options.accounts!.identity('streamer')!.id),
        );
        if (this.eligible())
          await this.getServices().wheel.configure(options.dashboard.getSettings());
      },
      onEnded: () => this.auto.failure(),
      onChat: () => this.auto.chat(),
      onStop: async () => {
        this.services?.forecast.interrupt();
        await this.services?.clips?.stop();
        if (this.services && this.eligible()) await this.services.wheel.pause();
      },
      onAuthorizationLost: () => this.handleRevocation(),
    });
    this.unsubscribe = options.accounts?.onRevoked(() => this.handleRevocation());
    this.detachClipPrivacy = options.store.onOptOut((viewerId) =>
      this.services?.clips?.forget(viewerId),
    );
  }
  private eligible(): boolean {
    return this.broadcasterType === 'affiliate' || this.broadcasterType === 'partner';
  }
  private blockReason(): string | null {
    if (!this.options.enabled) return 'Live listening is off. Set CHAT_SOURCE=live and restart.';
    const accounts = this.options.accounts;
    if (!accounts?.identity('streamer') || !accounts.identity('bot'))
      return 'Connect the streamer and a separate bot account.';
    if (accounts.identity('streamer')!.id === accounts.identity('bot')!.id)
      return 'Streamer and bot must be different accounts.';
    if (!this.options.apiKeyPresent)
      return 'OPENAI_API_KEY is missing. Live audio needs transcription; practice works without it.';
    for (const tool of ['streamlink', 'ffmpeg'] as const)
      if (this.options.tools && this.options.tools[tool] !== true)
        return (
          tool +
          ' is missing or not verified. Live audio capture needs it; practice works without it.'
        );
    return null;
  }
  initialize(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.services?.forecast.authorizationChanged();
    if (this.initializing) return this.initializing;
    const operation = this.initializeMonitor();
    this.initializing = operation;
    void operation
      .finally(() => {
        if (this.initializing === operation) this.initializing = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
  private async initializeMonitor(): Promise<void> {
    await this.auto.configure(this.options.dashboard.getSettings().autoListen);
    const accounts = this.options.accounts;
    if (!this.options.enabled || !accounts?.identity('streamer') || !accounts.identity('bot')) {
      this.auto.unavailable(this.blockReason() ?? 'Connect both Twitch accounts.');
      return;
    }
    if (this.monitor && !this.monitor.signal.aborted) return;
    const controller = new AbortController();
    this.monitor = controller;
    this.auto.unavailable('Connecting to Twitch stream notifications.');
    this.monitorTask = (async () => {
      while (!controller.signal.aborted) {
        try {
          const channel = accounts.identity('streamer')!.id;
          const { api, helix, wheel, forecast } = this.getServices();
          try {
            this.broadcasterType = await api.broadcasterType(channel);
          } catch {
            this.broadcasterType = null;
          }
          if (controller.signal.aborted) return;
          const sourceFactory =
            this.options.eventSource ??
            ((config: TwitchConfig, sourceOptions: LiveSourceOptions) =>
              new LiveChatSource(config, fetch, sourceOptions));
          const source = sourceFactory(
            {
              clientId: accounts.config.clientId,
              accessToken: await accounts.accessToken('streamer'),
              broadcasterId: channel,
              userId: channel,
            },
            {
              subscribe: async (sessionId, signal) => {
                const types = ['stream.online', 'stream.offline'];
                if (this.eligible())
                  types.push('channel.channel_points_custom_reward_redemption.add');
                for (const type of types)
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
              },
              onReady: async () => {
                if (controller.signal.aborted) return;
                await this.auto.ready();
                await forecast.recover();
                if (!this.probeTimer && !controller.signal.aborted) {
                  this.probeTimer = setInterval(() => {
                    void this.auto.reconcile();
                  }, 60_000);
                  this.probeTimer.unref();
                }
                if (this.eligible())
                  await wheel
                    .reconcile()
                    .catch(() =>
                      this.options.dashboard.setStatus(
                        'Stream notifications ready. Review pending wheel redemptions in Twitch.',
                      ),
                    );
              },
              onDisconnected: () => this.auto.disconnected(),
              onEvent: async (event) => {
                if (controller.signal.aborted) return;
                if (event.type === 'online') await this.auto.online(event.streamId);
                if (event.type === 'offline') await this.auto.offline();
                if (event.type === 'redemption' && this.eligible())
                  await wheel.redemption(event.redemption);
              },
            },
          );
          await source.run(() => undefined, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof AuthorizationRejected) {
            this.handleRevocation();
            return;
          }
          this.auto.disconnected();
        }
        if (!controller.signal.aborted)
          await abortableDelay(20_000, controller.signal).catch(() => undefined);
      }
    })();
    void this.monitorTask.catch(() =>
      this.auto.unavailable('Stream notifications stopped. Reconnect streamer.'),
    );
  }
  private async closeMonitor(): Promise<void> {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = undefined;
    this.monitor?.abort();
    await this.monitorTask?.catch(() => undefined);
    this.monitor = undefined;
    this.monitorTask = undefined;
  }
  private getServices() {
    const accounts = this.options.accounts;
    const streamer = accounts?.identity('streamer');
    const sender = accounts?.identity('bot');
    if (!accounts || !streamer || !sender) throw new Error('Connect streamer and bot accounts');
    const key = `${streamer.id}:${sender.id}`;
    if (this.services?.key !== key) {
      this.services?.bot.close();
      const helix =
        this.options.twitchApi ??
        new Helix(accounts, undefined, undefined, this.shutdownController.signal);
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
      const clips = this.options.ledger
        ? new ClipService({
            provider: new HelixClipProvider(helix),
            ledger: this.options.ledger,
            store: this.options.store,
            channelId: streamer.id,
            streamId: () => this.session.streamId,
            live: () => this.options.enabled && this.session.running,
            enabled: () => this.options.dashboard.getSettings().clipsEnabled,
            scopes: () => accounts.scopes('streamer'),
            onReady: (moment) => this.options.hub.publishClip(moment),
            announce: (moment, clip, signal) =>
              bot.clip(moment.id, moment.viewer, clip.url, signal),
          })
        : undefined;
      const forecast = new ForecastService({
        provider: new HelixPredictionProvider(this.options.twitchApi ?? new Helix(accounts)),
        store: this.options.store,
        channelId: streamer.id,
        streamId: () => this.session.streamId,
        listening: () => this.auto.snapshot().listening,
        eligible: () => this.eligible(),
        scope: () => accounts.scopes('streamer').includes('channel:manage:predictions'),
        changed: (view) => this.options.hub.setForecast(view),
      });
      this.services = { key, helix, api, bot, wheel, clips, forecast };
    }
    return this.services;
  }
  credit(moment: Moment): void {
    if (this.options.enabled && this.session.running && moment.streamId === this.session.streamId) {
      this.getServices().forecast.credit();
      this.getServices().clips?.credit(moment);
    }
  }
  forecastStatus(): ForecastView {
    return (
      this.services?.forecast.view() ?? {
        phase: 'idle',
        visible: this.eligible(),
        canStart: false,
        count: 0,
        target: FORECAST_RULES.target,
        endsAt: null,
        correctionEndsAt: null,
        proposed: null,
        source: 'live',
        message: !this.eligible()
          ? 'Chat forecast needs a verified Affiliate or Partner channel. Recognition and practice still work.'
          : 'Connect streamer and start live listening to create a forecast.',
      }
    );
  }
  forecastMoments() {
    return this.services?.forecast.view().phase === 'correction'
      ? this.services.forecast.reviewMoments()
      : [];
  }
  clipStatus() {
    // Media remains independent of forecasts and reward settlement.
    return (
      this.services?.clips?.status() ?? {
        message:
          'Clips wait for a new live credit. Reconnect streamer to enable clips if permission is missing.',
        markerMessage: 'Markers need VOD storage.',
        attempted: 0,
        limit: 20,
        pending: 0,
      }
    );
  }
  private currentStreamId(): string {
    const channel = this.options.accounts?.identity('streamer')?.id;
    return (
      this.session.streamId ||
      (channel ? this.options.store.getSetting(`last-stream:${channel}`) : '') ||
      ''
    );
  }
  entriesRefunded(): number {
    return this.services?.wheel.refundedCount() ?? 0;
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
    this.services?.clips?.forget(viewerId);
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
    if (!settings.clipsEnabled) await this.services?.clips?.stop();
    if (
      settings.wheelEnabled &&
      !this.eligible() &&
      !this.options.dashboard.getSettings().wheelEnabled
    )
      throw new DashboardActionError(
        'Channel Points need a verified Affiliate or Partner channel. Recognition still works.',
      );
    if (this.eligible() && (settings.wheelEnabled || this.services))
      await this.getServices().wheel.configure(settings);
  }
  async stop(abortNetwork = false): Promise<void> {
    this.closed = true;
    if (abortNetwork) {
      this.shutdownController.abort();
      this.services?.bot.close();
    }
    this.unsubscribe?.();
    this.detachClipPrivacy();
    try {
      await Promise.allSettled([
        this.closeMonitor(),
        this.auto.close(),
        this.services?.forecast.close(),
      ]);
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
    await this.services?.forecast.close(true);
    this.clearLocal();
    this.options.accounts?.disconnect('bot');
    this.options.accounts?.disconnect('streamer');
    await this.closeMonitor();
    await this.auto.close().catch(() => undefined);
    this.auto.unavailable('Twitch authorization was revoked. Reconnect both accounts.');
    this.broadcasterType = null;
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
    start: async () => {
      const blocked = this.blockReason();
      if (blocked) throw new DashboardActionError(blocked);
      await this.initialize();
      let stream: string | null;
      try {
        stream = await this.getServices().api.liveStream(
          this.options.accounts!.identity('streamer')!.id,
        );
      } catch {
        throw new DashboardActionError(
          'Cannot check Twitch stream status. Reconnect streamer or check your connection.',
        );
      }
      if (!stream)
        throw new DashboardActionError(
          'Your Twitch channel is offline. Go live first, or leave Auto-listen enabled to wait.',
        );
      await this.auto.online(stream, true);
    },
    stop: () => this.auto.pause(),
    settingsSaved: () => this.initialize(),
    settingsChanged: (settings) => this.settingsChanged(settings),
    rollCredits: async () => {
      await this.auto.pause();
      return this.finish();
    },
    spinWheel: async () => {
      if (!this.eligible())
        throw new DashboardActionError(
          'The live Channel Points wheel needs a verified Affiliate or Partner channel. Use the practice wheel without Channel Points.',
        );
      const result = await this.getServices().wheel.spin();
      this.options.dashboard.setWinner(result.winner?.viewer);
      return result;
    },
    disconnect: async (role) => {
      await this.services?.forecast.close(true);
      await this.closeMonitor();
      await this.auto.close().catch(() => undefined);
      this.broadcasterType = null;
      try {
        await this.session.stop();
        if (this.services)
          await this.services.wheel.configure({
            ...this.options.dashboard.getSettings(),
            wheelEnabled: false,
          });
      } finally {
        this.auto.unavailable('An account was disconnected. Connect both Twitch accounts.');
        this.clearLocal();
        this.services?.bot.close();
        this.services = undefined;
        this.session.streamId = '';
        for (const accountRole of role ? [role] : (['bot', 'streamer'] as const))
          this.options.accounts?.disconnect(accountRole);
        this.options.dashboard.clearTranscripts();
        this.options.dashboard.setStatus(
          role
            ? `Disconnected the ${role} account. Listening stopped; reconnect that role to continue.`
            : 'Both accounts disconnected. Connect the streamer and a different bot account.',
        );
      }
    },
    startForecast: async (minutes) => {
      if (!this.eligible())
        throw new DashboardActionError('Chat forecast needs an Affiliate or Partner channel.');
      try {
        await this.getServices().forecast.start(minutes);
      } catch (error) {
        throw new DashboardActionError(
          error instanceof Error ? error.message : 'Forecast could not start.',
        );
      }
    },
    cancelForecast: async () => {
      if (!this.services) throw new DashboardActionError('No live forecast is active.');
      try {
        await this.services.forecast.cancel();
      } catch (error) {
        throw new DashboardActionError(
          error instanceof Error ? error.message : 'Cancellation could not be requested.',
        );
      }
    },
    correctForecast: async (id, excluded) => {
      if (!this.services) throw new DashboardActionError('No live forecast review is active.');
      try {
        this.services.forecast.exclude(id, excluded);
      } catch (error) {
        throw new DashboardActionError(
          error instanceof Error ? error.message : 'Correction could not be saved.',
        );
      }
    },
  };
}
