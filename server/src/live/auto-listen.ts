import { abortableDelay } from '../runtime/time.js';

export const HLS_RETRIES = 6;
export const HLS_RETRY_MS = 20_000;
export const OFFLINE_EMPTY_PROBES = 3;
export const OFFLINE_AUDIO_GRACE_MS = 90_000;
export interface ListeningStatus {
  autoListen: boolean;
  listening: boolean;
  phase: 'not-listening' | 'standby' | 'connecting' | 'listening';
  reason: string;
  lastAudioAt: number | null;
  lastChatAt: number | null;
  retry: number;
}

// One stream ID owns one capture attempt or retry timer. Event delivery IDs are insufficient
// for deduplication: a new WebSocket may describe the same stream with a new delivery ID.
export class AutoListener {
  private streamId: string | null = null;
  private controller?: AbortController;
  private pending?: Promise<void>;
  private connected = false;
  private auto = true;
  private paused = '';
  private pausedReason = '';
  private revision = 0;
  private probing = false;
  private emptyProbes = 0;
  private state: ListeningStatus = {
    autoListen: true,
    listening: false,
    phase: 'not-listening',
    reason: 'Checking local startup requirements.',
    lastAudioAt: null,
    lastChatAt: null,
    retry: 0,
  };
  constructor(
    private readonly options: {
      start: (streamId: string) => Promise<void>;
      stop: () => Promise<void>;
      finish: () => Promise<unknown>;
      probe: () => Promise<string | null>;
      blockReason: () => string | null;
      readPause: () => string;
      savePause: (streamId: string) => void;
      readPauseReason?: () => string;
      savePauseReason?: (reason: string) => void;
      now?: () => number;
      wait?: (ms: number, signal: AbortSignal) => Promise<void>;
    },
  ) {
    this.paused = options.readPause();
    this.pausedReason = options.readPauseReason?.() ?? '';
  }

  snapshot(): ListeningStatus {
    return { ...this.state, autoListen: this.auto };
  }
  private idle(reason?: string): void {
    const effectiveReason = this.pausedReason && this.paused ? this.pausedReason : reason;
    this.state.listening = false;
    this.state.phase =
      this.connected && this.auto && !effectiveReason ? 'standby' : 'not-listening';
    this.state.reason =
      effectiveReason ??
      (this.auto
        ? 'Waiting for your Twitch stream to go live.'
        : 'Auto-listen is off. Choose Start listening when live.');
  }
  unavailable(reason: string): void {
    this.connected = false;
    this.idle(reason);
  }
  async configure(auto: boolean): Promise<void> {
    this.auto = auto;
    if (!auto && !this.state.listening && this.state.phase !== 'connecting') this.idle();
    if (auto && this.connected && !this.controller) await this.reconcile();
  }
  async ready(): Promise<void> {
    this.connected = true;
    await this.reconcile();
  }
  disconnected(): void {
    this.connected = false;
    if (this.state.listening)
      this.state.reason = 'Receiving audio; reconnecting Twitch stream notifications.';
    if (!this.controller) this.idle('Reconnecting to Twitch stream notifications.');
  }
  async reconcile(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    const revision = this.revision;
    try {
      const stream = await this.options.probe();
      if (revision !== this.revision) return;
      if (!stream) {
        // Get Streams can lag the online event. Recent audio outranks an empty row.
        // Idle states still repair a missed offline event on the first empty probe.
        if (this.controller && !this.controller.signal.aborted) {
          this.emptyProbes = Math.min(OFFLINE_EMPTY_PROBES, this.emptyProbes + 1);
          const recentAudio =
            this.state.lastAudioAt !== null &&
            (this.options.now ?? Date.now)() - this.state.lastAudioAt < OFFLINE_AUDIO_GRACE_MS;
          if (this.emptyProbes < OFFLINE_EMPTY_PROBES || recentAudio) return;
        }
        await this.offline();
        return;
      }
      this.emptyProbes = 0;
      if (this.auto) await this.online(stream);
      else if (!this.controller) this.idle();
    } catch {
      this.emptyProbes = 0;
      if (!this.controller)
        this.idle(
          'Cannot check Twitch stream status. Reconnect streamer or retry after the connection recovers.',
        );
    } finally {
      this.probing = false;
    }
  }
  async online(streamId: string, manual = false): Promise<void> {
    if (!manual && !this.auto) return;
    this.emptyProbes = 0;
    this.revision++;
    if (!manual && (this.streamId === streamId || this.paused === streamId)) {
      if (this.paused === streamId)
        this.idle(
          this.pausedReason ||
            'Stopped by you for this stream. Practice is available; choose Start listening to resume.',
        );
      return;
    }
    if (this.controller) {
      if (this.streamId === streamId) return;
      await this.cancel();
    }
    const blocked = this.options.blockReason();
    if (blocked) {
      this.idle(blocked);
      return;
    }
    this.streamId = streamId;
    if (manual || this.paused !== streamId) {
      this.pausedReason = '';
      this.options.savePauseReason?.('');
    }
    if (manual) {
      this.paused = '';
      this.options.savePause('');
    }
    this.state.retry = 0;
    this.state.lastAudioAt = null;
    this.state.lastChatAt = null;
    this.controller = new AbortController();
    await this.attempt(this.controller);
  }
  private async attempt(controller: AbortController): Promise<void> {
    if (controller.signal.aborted) return;
    this.state.phase = 'connecting';
    this.state.listening = false;
    this.state.reason = this.state.retry
      ? `Waiting for live audio: retry ${this.state.retry}/${HLS_RETRIES}.`
      : 'Connecting chat and waiting for the first audio chunk.';
    try {
      await this.options.start(this.streamId!);
    } catch {
      this.failure();
    }
  }
  inputEnded(): void {
    const controller = this.controller;
    if (!controller || controller.signal.aborted || this.pending) return;
    this.state.listening = false;
    this.state.phase = 'connecting';
    if (this.state.retry >= HLS_RETRIES) {
      this.controller = undefined;
      this.idle(
        `Audio capture could not start or recover after ${HLS_RETRIES} retries. Check streamlink, ffmpeg and stream access, then choose Start listening to retry.`,
      );
      return;
    }
    this.state.retry++;
    this.state.reason = `Live audio is not ready or input ended. Retrying in 20 seconds (${this.state.retry}/${HLS_RETRIES}). Stop listening cancels retries.`;
    const operation = (async () => {
      await (this.options.wait ?? abortableDelay)(HLS_RETRY_MS, controller.signal);
      if (!controller.signal.aborted) await this.attempt(controller);
    })();
    this.pending = operation;
    void operation
      .catch(() => undefined)
      .finally(() => {
        if (this.pending === operation) this.pending = undefined;
        // A synchronous start failure needs the same bounded retry path as an async input end.
        if (
          !controller.signal.aborted &&
          this.controller === controller &&
          this.state.phase === 'connecting' &&
          this.failedDuringRetry
        ) {
          this.failedDuringRetry = false;
          this.inputEnded();
        }
      });
  }
  private failedDuringRetry = false;
  failure(): void {
    if (this.pending) this.failedDuringRetry = true;
    else this.inputEnded();
  }
  audio(): void {
    if (!this.controller || this.controller.signal.aborted) return;
    this.state.lastAudioAt = (this.options.now ?? Date.now)();
    this.state.listening = true;
    this.state.phase = 'listening';
    this.state.reason = this.connected
      ? 'Receiving stream audio.'
      : 'Receiving audio; reconnecting Twitch stream notifications.';
    // A later failure receives a fresh recovery budget after actual successful capture.
    this.state.retry = 0;
  }
  chat(): void {
    this.state.lastChatAt = (this.options.now ?? Date.now)();
  }
  private async cancel(): Promise<void> {
    this.controller?.abort();
    this.controller = undefined;
    this.state.listening = false;
    this.failedDuringRetry = false;
    await this.pending?.catch(() => undefined);
    await this.options.stop();
  }
  async pause(): Promise<void> {
    this.pausedReason = '';
    this.options.savePauseReason?.('');
    this.revision++;
    if (this.streamId) {
      this.paused = this.streamId;
      this.options.savePause(this.streamId);
    }
    try {
      await this.cancel();
    } finally {
      this.idle(
        'Stopped by you for this stream. Practice is available; choose Start listening to resume.',
      );
    }
  }
  async rejectProvider(reason: string): Promise<void> {
    this.revision++;
    if (this.streamId) {
      this.paused = this.streamId;
      this.options.savePause(this.streamId);
    }
    this.pausedReason = reason;
    this.options.savePauseReason?.(reason);
    try {
      await this.cancel();
    } finally {
      this.idle(reason);
    }
  }
  async offline(): Promise<void> {
    this.emptyProbes = 0;
    this.revision++;
    const hadStream = !!this.streamId;
    try {
      // A failed remote reward pause must not prevent local end credits.
      await this.cancel().catch(() => undefined);
      this.streamId = null;
      // A cached empty Get Streams result must not re-arm rejected credentials for the same ID.
      if (!this.pausedReason) {
        this.paused = '';
        this.options.savePauseReason?.('');
        this.options.savePause('');
      }
      if (hadStream) await this.options.finish();
    } finally {
      this.idle(this.options.blockReason() ?? undefined);
    }
  }
  async close(): Promise<void> {
    this.emptyProbes = 0;
    this.revision++;
    this.connected = false;
    try {
      await this.cancel();
    } finally {
      this.streamId = null;
      this.idle('Server is stopping.');
    }
  }
}
