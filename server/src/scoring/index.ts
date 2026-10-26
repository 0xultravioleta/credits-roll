import type { CreditQuote, Moment, MomentKind, Reputation, Viewer } from '../domain.js';
import { Store } from '../store/index.js';
import { scoreMoment, wheelWeight } from './rules.js';
export {
  BASE_POINTS,
  WHEEL_WEIGHT_BASE,
  WHEEL_WEIGHT_CAP,
  scoreMoment,
  wheelWeight,
} from './rules.js';

export interface WheelEntry extends Reputation {
  weight: number;
}
export interface CreditEntry {
  viewer: Viewer;
  momentCount: number;
  points: number;
  kinds: MomentKind[];
  quotes: CreditQuote[];
}

export class Scoring {
  constructor(private readonly store: Store) {}

  credit(moment: Moment): boolean {
    const points = scoreMoment(moment);
    return points > 0 && this.store.recordMoment(moment, points);
  }

  creditedViewers(streamId?: string): CreditedViewer[] {
    const reputation = new Map(
      this.store.getReputation().map((row) => [row.viewer.id, row.points]),
    );
    const viewers = new Map<string, CreditedViewer>();
    for (const moment of this.store.getMoments(streamId)) {
      const points = reputation.get(moment.viewer.id) ?? 0;
      const row = viewers.get(moment.viewer.id) ?? {
        viewer: moment.viewer,
        points,
        wheelWeight: wheelWeight(points),
        momentCount: 0,
        lastCreditedAt: moment.occurredAt,
        moments: [],
      };
      row.momentCount++;
      row.lastCreditedAt = Math.max(row.lastCreditedAt, moment.occurredAt);
      row.moments.unshift(moment);
      viewers.set(moment.viewer.id, row);
    }
    return [...viewers.values()].sort(
      (a, b) => b.points - a.points || a.viewer.id.localeCompare(b.viewer.id),
    );
  }

  credits(streamId: string): CreditEntry[] {
    const entries = new Map<string, CreditEntry>();
    for (const moment of this.store.getMoments(streamId)) {
      const entry = entries.get(moment.viewer.id) ?? {
        viewer: moment.viewer,
        momentCount: 0,
        points: 0,
        kinds: [],
        quotes: [],
      };
      entry.momentCount += 1;
      entry.points += moment.pointsEarned ?? scoreMoment(moment);
      entry.quotes.push({ text: moment.quote, occurredAt: moment.occurredAt });
      if (!entry.kinds.includes(moment.kind)) entry.kinds.push(moment.kind);
      entries.set(moment.viewer.id, entry);
    }
    return [...entries.values()].sort(
      (a, b) => b.points - a.points || a.viewer.id.localeCompare(b.viewer.id),
    );
  }

  wheelEntries(eligibleViewerIds?: ReadonlySet<string>): WheelEntry[] {
    return this.store
      .getReputation()
      .filter(
        (entry) =>
          entry.points > 0 && (!eligibleViewerIds || eligibleViewerIds.has(entry.viewer.id)),
      )
      .map((entry) => ({ ...entry, weight: wheelWeight(entry.points) }));
  }
}

export function drawWheel(
  entries: WheelEntry[],
  random: () => number = Math.random,
): WheelEntry | undefined {
  const eligible = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  if (eligible.length === 0) return undefined;
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error('Wheel random value must be in [0, 1)');
  let remaining = sample * eligible.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of eligible) {
    remaining -= entry.weight;
    if (remaining < 0) return entry;
  }
  return eligible.at(-1);
}

export interface CreditedViewer {
  viewer: Viewer;
  points: number;
  wheelWeight: number;
  momentCount: number;
  lastCreditedAt: number;
  moments: Moment[];
}
