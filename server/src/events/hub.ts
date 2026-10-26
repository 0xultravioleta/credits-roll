import type { Moment } from '../domain.js';
import { Scoring } from '../scoring/index.js';
import { Store } from '../store/index.js';
import type { OverlayEvent, OverlayState } from './protocol.js';

export class OverlayHub {
  private readonly listeners = new Set<(event: OverlayEvent) => void>();
  private phase: OverlayState['phase'] = 'live';
  private streamId = 'rehearsal';
  private rehearsal?: { store: Store; scoring: Scoring; streamId: string };

  constructor(
    private readonly store: Store,
    private readonly scoring: Scoring,
    private readonly onEvent?: (event: OverlayEvent) => void,
  ) {}

  get subscriberCount(): number {
    return this.listeners.size;
  }

  snapshot(): OverlayState {
    const store = this.rehearsal?.store ?? this.store;
    const scoring = this.rehearsal?.scoring ?? this.scoring;
    return {
      phase: this.phase,
      streamId: this.streamId,
      moments:
        this.phase === 'live'
          ? store
              .getMoments(this.streamId)
              .filter((moment) => moment.occurredAt > Date.now() - 30_000)
              .slice(-5)
              .map(overlayMoment)
          : [],
      credits: scoring.credits(this.streamId),
      wheel: scoring.wheelEntries(),
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
    if (this.rehearsal && moment.streamId !== this.rehearsal.streamId) {
      this.rehearsal = undefined;
      this.emit({ type: 'reset' });
    }
    if ((this.rehearsal?.store ?? this.store).isOptedOut(moment.viewer.id)) return;
    this.phase = 'live';
    this.streamId = moment.streamId;
    this.emit({ type: 'moment', moment: overlayMoment(moment) });
  }
  beginStream(streamId: string): void {
    if (this.rehearsal) this.emit({ type: 'reset' });
    this.rehearsal = undefined;
    this.phase = 'live';
    this.streamId = streamId;
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }
  reset(): void {
    this.rehearsal = undefined;
    this.phase = 'live';
    this.streamId = 'rehearsal';
    this.emit({ type: 'reset' });
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }

  rollCredits(streamId: string): void {
    if (this.rehearsal && streamId !== this.rehearsal.streamId) this.rehearsal = undefined;
    this.phase = 'credits';
    this.streamId = streamId;
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }

  forgetViewer(viewerId: string): void {
    this.emit({ type: 'optout', viewerId });
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }

  showRehearsal(store: Store, scoring: Scoring, streamId: string): void {
    this.rehearsal = { store, scoring, streamId };
    this.streamId = streamId;
    this.phase = 'live';
    this.emit({ type: 'reset' });
    this.emit({ type: 'snapshot', state: this.snapshot() });
  }

  private emit(event: OverlayEvent): void {
    this.onEvent?.(event);
    for (const listener of this.listeners) listener(event);
  }
  creditedViewers(streamId?: string) {
    return (this.rehearsal?.scoring ?? this.scoring).creditedViewers(streamId);
  }
}

function overlayMoment(moment: Moment): Moment {
  const publicMoment = { ...moment };
  delete publicMoment.adoptionExcerpt;
  return publicMoment;
}

export function encodeSse(event: OverlayEvent): string {
  return `event: overlay\ndata: ${JSON.stringify(event)}\n\n`;
}
