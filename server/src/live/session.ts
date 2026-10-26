import { randomUUID } from 'node:crypto';
import type { OAuthAccounts } from '../auth/oauth.js';
import type { ChatSource } from '../twitch/source.js';
import type { TwitchConfig } from '../twitch/live.js';
import type { TranscriptSource } from '../transcript/source.js';
import { DashboardState } from '../dashboard/state.js';
import { OverlayHub } from '../events/hub.js';
import { Pipeline } from '../pipeline.js';

export class ListeningSession {
  private controller?: AbortController;
  private tasks: Promise<unknown>[] = [];
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
    },
  ) {}
  async start(): Promise<void> {
    if (this.controller && !this.controller.signal.aborted) return;
    await this.stop();
    if (!this.options.enabled || !this.options.accounts) {
      this.options.dashboard.setStatus(
        'Set CHAT_SOURCE=live and configure Twitch OAuth before listening.',
      );
      throw new Error('Live mode is disabled');
    }
    const streamer = this.options.accounts.identity('streamer');
    const bot = this.options.accounts.identity('bot');
    if (!streamer || !bot) throw new Error('Connect both Twitch accounts');
    const controller = new AbortController();
    this.controller = controller;
    try {
      const accessToken = await this.options.accounts.accessToken('bot');
      this.streamId = this.options.stream ? await this.options.stream() : `live-${randomUUID()}`;
      if (controller.signal.aborted) return;
      this.options.pipeline.clearChat();
      this.options.hub.beginStream(this.streamId);
      this.options.dashboard.setStatus('Connecting live chat and audio.');
      const chat = this.options.chat({
        clientId: this.options.accounts.config.clientId,
        accessToken,
        broadcasterId: streamer.id,
        userId: bot.id,
      });
      const transcript = this.options.transcript(this.streamId, streamer.login);
      const onError = () => {
        if (!controller.signal.aborted) {
          this.options.dashboard.setStatus(
            'Live input stopped. Check authorization, stream access and providers.',
          );
          controller.abort();
        }
      };
      this.tasks = [
        chat
          .run((message) => this.options.pipeline.addChat(message), controller.signal)
          .catch(onError),
        transcript
          .run(async (window) => {
            await this.options.pipeline.processWindow(window);
          }, controller.signal)
          .catch(onError),
      ];
    } catch {
      controller.abort();
      this.controller = undefined;
      this.options.dashboard.setStatus(
        'Unable to start. Connect both accounts and make sure the channel is live.',
      );
      throw new Error('Unable to start live listening');
    }
  }
  async stop(): Promise<void> {
    if (!this.controller) return;
    this.controller.abort();
    this.controller = undefined;
    await Promise.allSettled(this.tasks);
    this.tasks = [];
    this.options.pipeline.clearChat();
    this.options.dashboard.clearTranscripts();
    this.options.dashboard.setStatus('Listening stopped.');
  }
}
