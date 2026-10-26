import type { Moment, MomentKind, Reputation, Viewer } from '../domain.js';
import { MIN_CONFIDENCE } from '../matcher/index.js';
import { Store } from '../store/index.js';

const BASE_POINTS: Record<MomentKind, number> = { idea: 10, assist: 8, riff: 6 };

export function scoreMoment(moment: Pick<Moment, 'kind' | 'confidence'>): number {
  if (
    !Number.isFinite(moment.confidence) ||
    moment.confidence < MIN_CONFIDENCE ||
    moment.confidence > 1
  )
    return 0;
  return Math.round((BASE_POINTS[moment.kind] ?? 0) * moment.confidence);
}

// Diminishing returns keep prolific viewers from dominating the wheel.
export function wheelWeight(points: number): number {
  return Number.isFinite(points) && points > 0
    ? Math.min(20, 1 + Math.floor(Math.sqrt(points)))
    : 0;
}

export interface WheelEntry extends Reputation {
  weight: number;
}
export interface CreditEntry {
  viewer: Viewer;
  momentCount: number;
  points: number;
  kinds: MomentKind[];
}

export class Scoring {
  constructor(private readonly store: Store) {}

  credit(moment: Moment): boolean {
    const points = scoreMoment(moment);
    return points > 0 && this.store.recordMoment(moment, points);
  }

  credits(streamId: string): CreditEntry[] {
    const entries = new Map<string, CreditEntry>();
    for (const moment of this.store.getMoments(streamId)) {
      const entry = entries.get(moment.viewer.id) ?? {
        viewer: moment.viewer,
        momentCount: 0,
        points: 0,
        kinds: [],
      };
      entry.momentCount += 1;
      entry.points += scoreMoment(moment);
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
