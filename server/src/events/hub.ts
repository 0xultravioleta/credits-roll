import type { Moment } from '../domain.js';
import { Scoring } from '../scoring/index.js';
import { Store } from '../store/index.js';
import type { OverlayEvent, OverlayState } from './protocol.js';

export class OverlayHub {
  private readonly listeners = new Set<(event: OverlayEvent) => void>();
  private phase: OverlayState['phase'] = 'live';
  private streamId = 'rehearsal';

  constructor(
    private readonly store: Store,
    private readonly scoring: Scoring,
  ) {}

  get subscriberCount(): number {
    return this.listeners.size;
  }

  snapshot(): OverlayState {
    return {
      phase: this.phase,
      streamId: this.streamId,
      moments:
        this.phase === 'live'
          ? this.store
              .getMoments(this.streamId)
              .filter((moment) => moment.occurredAt > Date.now() - 30_000)
              .slice(-5)
          : [],
      credits: this.scoring.credits(this.streamId),
      wheel: this.scoring.wheelEntries(),
    };
  }

  subscribe(listener: (event: OverlayEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: 'snapshot', state: this.snapshot() });
    return () => {
      this.listeners.delete(listener);
    };
  }

  publishMoment(moment: Moment): void {
    if (this.store.isOptedOut(moment.viewer.id)) return;
    this.phase = 'live';
    this.streamId = moment.streamId;
    this.emit({ type: 'moment', moment });
  }
  beginStream(streamId: string): void {
    this.phase = 'live';
    this.streamId = streamId;
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }
  reset(): void {
    this.phase = 'live';
    this.streamId = 'rehearsal';
    this.emit({ type: 'reset' });
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }

  rollCredits(streamId: string): void {
    this.phase = 'credits';
    this.streamId = streamId;
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }

  forgetViewer(viewerId: string): void {
    this.emit({ type: 'optout', viewerId });
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }

  private emit(event: OverlayEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function encodeSse(event: OverlayEvent): string {
  return `event: overlay\ndata: ${JSON.stringify(event)}\n\n`;
}
