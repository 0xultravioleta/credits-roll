import { randomUUID } from 'node:crypto';
import type { OAuthAccounts } from '../auth/oauth.js';
import { AuthorizationRejected } from '../auth/oauth.js';
import type { ChatSource } from '../twitch/source.js';
import type { TwitchConfig } from '../twitch/live.js';
import type { TranscriptSource } from '../transcript/source.js';
import { DashboardState } from '../dashboard/state.js';
import { OverlayHub } from '../events/hub.js';
import { Pipeline } from '../pipeline.js';
import { DashboardActionError } from '../dashboard/action-error.js';

export class ListeningSession {
  private controller?: AbortController;
  private tasks: Promise<unknown>[] = [];
  private starting?: Promise<void>;
  private stopRequested = false;
  private stopping?: Promise<void>;
  streamId = '';
  constructor(
    private readonly options: {
      enabled: boolean;
      accounts?: OAuthAccounts;
      dashboard: DashboardState;
      hub: OverlayHub;
      pipeline: Pipeline;
      chat: (config: TwitchConfig) => ChatSource;
      transcript: (streamId: string, channel: string) => TranscriptSource;
      stream?: () => Promise<string>;
      events?: () => ChatSource | Promise<ChatSource>;
      onStart?: () => Promise<void>;
      onStop?: () => Promise<void>;
      onAuthorizationLost?: () => void;
      onEnded?: () => void;
      onChat?: () => void;
    },
  ) {}
  start(streamId?: string): Promise<void> {
    if (this.stopping)
      return Promise.reject(
        new DashboardActionError(
          'The previous session is still stopping. Wait for Stop listening to finish, then try again.',
        ),
      );
    if (this.starting) return this.starting;
    this.stopRequested = false;
    const operation = this.begin(streamId);
    this.starting = operation;
    void operation
      .finally(() => {
        if (this.starting === operation) this.starting = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
  private async begin(streamId?: string): Promise<void> {
    if (this.controller && !this.controller.signal.aborted)
      throw new DashboardActionError('Already listening. Choose Stop listening to use practice.');
    await this.stopInputs();
    if (this.stopRequested) return;
    if (!this.options.enabled || !this.options.accounts) {
      this.options.dashboard.setStatus(
        'Set CHAT_SOURCE=live and configure Twitch OAuth before listening.',
      );
      throw new DashboardActionError(
        'Live listening is disabled. Set CHAT_SOURCE=live and configure Twitch OAuth.',
      );
    }
    const streamer = this.options.accounts.identity('streamer');
    const bot = this.options.accounts.identity('bot');
    if (!streamer || !bot)
      throw new DashboardActionError(
        'Connect the streamer and a separate bot account before listening.',
      );
    if (streamer.id === bot.id)
      throw new DashboardActionError('Streamer and bot must be different accounts.');
    const controller = new AbortController();
    this.controller = controller;
    try {
      const accessToken = await this.options.accounts.accessToken('bot');
      this.streamId =
        streamId ?? (this.options.stream ? await this.options.stream() : `live-${randomUUID()}`);
      if (controller.signal.aborted) return;
      this.options.pipeline.clearChat();
      this.options.hub.beginStream(this.streamId);
      this.options.dashboard.setStatus('Connecting live chat and audio.');
      await this.options.onStart?.();
      if (controller.signal.aborted) {
        await this.options.onStop?.();
        return;
      }
      const chat = this.options.chat({
        clientId: this.options.accounts.config.clientId,
        accessToken,
        broadcasterId: streamer.id,
        userId: bot.id,
      });
      const transcript = this.options.transcript(this.streamId, streamer.login);
      const ended = (message: string) => {
        if (controller.signal.aborted) return;
        controller.abort();
        void this.stop()
          .then(() => {
            this.options.dashboard.setStatus(message);
          })
          .catch(() =>
            this.options.dashboard.setStatus(
              'Local listening stopped. Check pending Channel Points rewards in Twitch.',
            ),
          )
          .finally(() => this.options.onEnded?.());
      };
      const onError = (error: unknown) => {
        if (!controller.signal.aborted) {
          this.options.dashboard.setStatus(
            'Live input stopped. Check authorization, stream access and providers.',
          );
          ended(
            'Live input stopped. Reconnect accounts or check stream access. Practice is available.',
          );
          if (error instanceof AuthorizationRejected) this.options.onAuthorizationLost?.();
        }
      };
      this.tasks = [
        chat
          .run((message) => {
            this.options.onChat?.();
            return this.options.pipeline.addChat(message);
          }, controller.signal)
          .then(() => ended('Live chat input ended. Listening stopped; practice is available.'))
          .catch(onError),
        transcript
          .run(async (window) => {
            await this.options.pipeline.processWindow(window);
          }, controller.signal)
          .then((result) =>
            ended(
              result === 'skipped'
                ? 'Audio capture was skipped. Check streamlink, ffmpeg and OPENAI_API_KEY. Practice is available.'
                : 'Live audio ended. Listening stopped; practice is available.',
            ),
          )
          .catch(onError),
      ];
      if (this.options.events)
        this.tasks.push(
          (await this.options.events()).run(() => undefined, controller.signal).catch(onError),
        );
    } catch (error) {
      controller.abort();
      await this.stopInputs().catch(() => undefined);
      if (this.stopRequested) return;
      this.options.dashboard.setStatus(
        'Unable to start. Connect both accounts and make sure the channel is live.',
      );
      if (error instanceof DashboardActionError) throw error;
      throw new DashboardActionError(
        error instanceof AuthorizationRejected
          ? 'Twitch authorization was rejected. Reconnect both accounts.'
          : 'Unable to start live listening. Check Twitch authorization, go live on the connected channel, then try again.',
      );
    }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopRequested = true;
    this.controller?.abort();
    this.options.pipeline.clearChat();
    const operation = (async () => {
      await this.starting?.catch(() => undefined);
      await this.stopInputs();
      this.options.dashboard.setStatus('Listening stopped. Practice is available.');
    })();
    this.stopping = operation;
    void operation
      .finally(() => {
        if (this.stopping === operation) this.stopping = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
  private async stopInputs(): Promise<void> {
    if (!this.controller) return;
    this.controller.abort();
    this.controller = undefined;
    await Promise.allSettled(this.tasks);
    this.tasks = [];
    try {
      await this.options.onStop?.();
    } finally {
      this.options.pipeline.clearChat();
      this.options.dashboard.clearTranscripts();
      this.options.dashboard.setStatus('Listening stopped.');
    }
  }
  get running(): boolean {
    return !!this.controller && !this.controller.signal.aborted;
  }
}
