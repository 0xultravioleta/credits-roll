import type { Moment } from '../../server/src/domain.js';
import type { OverlayEvent, OverlayState } from '../../server/src/events/protocol.js';

export const POPUP_MS = 6000;

export class OverlayModel {
  phase: OverlayState['phase'] = 'live';
  credits: OverlayState['credits'] = [];
  wheel: OverlayState['wheel'] = [];
  current?: { moment: Moment; startedAt: number };
  creditsStartedAt = 0;
  connected = false;
  private streamId = '';
  private queue: Moment[] = [];
  private readonly seen = new Set<string>();
  private readonly optedOut = new Set<string>();

  accept(event: OverlayEvent, now: number): void {
    if (event.type === 'reset') {
      this.current = undefined;
      this.queue = [];
      this.credits = [];
      this.wheel = [];
      this.phase = 'live';
      this.seen.clear();
    } else if (event.type === 'optout') {
      this.optedOut.add(event.viewerId);
      this.queue = this.queue.filter((moment) => moment.viewer.id !== event.viewerId);
      if (this.current?.moment.viewer.id === event.viewerId) this.current = undefined;
      this.credits = this.credits.filter((entry) => entry.viewer.id !== event.viewerId);
      this.wheel = this.wheel.filter((entry) => entry.viewer.id !== event.viewerId);
    } else if (event.type === 'moment') {
      this.phase = 'live';
      this.enqueue(event.moment);
    } else {
      const state = event.state;
      this.credits = state.credits.filter((entry) => !this.optedOut.has(entry.viewer.id));
      this.wheel = state.wheel.filter((entry) => !this.optedOut.has(entry.viewer.id));
      if (state.phase === 'credits') {
        if (this.phase !== 'credits' || this.streamId !== state.streamId)
          this.creditsStartedAt = now;
        this.current = undefined;
        this.queue = [];
      } else state.moments.forEach((moment) => this.enqueue(moment));
      this.phase = state.phase;
      this.streamId = state.streamId;
    }
  }

  tick(now: number): void {
    const cutoff = Date.now() - 72 * 60 * 60 * 1000;
    this.credits = this.credits.flatMap((entry) => {
      if (!entry.quotes) return [entry];
      const quotes = entry.quotes.filter((quote) => quote.occurredAt > cutoff);
      return quotes.length ? [{ ...entry, quotes }] : [];
    });
    if (
      this.current &&
      (now - this.current.startedAt >= POPUP_MS ||
        Date.now() - this.current.moment.occurredAt >= 72 * 60 * 60 * 1000)
    )
      this.current = undefined;
    if (!this.current && this.queue.length) {
      const moment = this.queue.shift();
      if (moment) this.current = { moment, startedAt: now };
    }
  }

  private enqueue(moment: Moment): void {
    if (Date.now() - moment.occurredAt >= 72 * 60 * 60 * 1000) return;
    if (this.seen.has(moment.id) || this.optedOut.has(moment.viewer.id)) return;
    this.seen.add(moment.id);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!);
    this.queue.push(moment);
    if (this.queue.length > 50) this.queue.shift();
  }
}
