import type { CreditQuote, Moment, MomentKind, Reputation, Viewer } from '../domain.js';
import { Store } from '../store/index.js';
import { scoreMoment, wheelWeight } from './rules.js';
import { creditRecord } from '../ledger/index.js';
import type { CreditContext, CreditSink, MemoryCreditLedger } from '../ledger/index.js';
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
  constructor(
    private readonly store: Store,
    private readonly ledger?: MemoryCreditLedger,
    private readonly context: () => CreditContext = () => ({
      channelId: 'local',
      judgeModel: 'unknown',
    }),
    private readonly sink: CreditSink | undefined = ledger,
  ) {}

  credit(moment: Moment): boolean {
    const points = scoreMoment(moment);
    if (points <= 0) return false;
    const record = creditRecord(moment, points, this.context());
    if (this.ledger?.hasCredit(record)) return false;
    return this.store.recordMoment(moment, points, () => this.sink?.onCredit(record));
  }

  creditedViewers(streamId?: string): CreditedViewer[] {
    const history = this.ledger?.read();
    const moments: Moment[] = history
      ? history
          .filter(
            (row) =>
              !this.store.isOptedOut(row.viewerId) && (!streamId || row.streamId === streamId),
          )
          .map((row) => ({
            id: row.id,
            streamId: row.streamId,
            messageId: row.sourceMessageId,
            viewer: { id: row.viewerId, login: row.login },
            quote: row.quote,
            adoptionExcerpt: row.adoptionExcerpt,
            kind: row.kind,
            confidence: row.confidence,
            pointsEarned: row.points,
            occurredAt: Date.parse(row.time),
          }))
          .sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id))
      : this.store.getMoments(streamId);
    const reputation = new Map(
      this.store.getReputation().map((row) => [row.viewer.id, row.points]),
    );
    const viewers = new Map<string, CreditedViewer>();
    if (history) {
      const totals = new Map<string, number>();
      for (const row of history)
        totals.set(row.viewerId, (totals.get(row.viewerId) ?? 0) + row.points);
      for (const [id, total] of totals)
        reputation.set(id, Math.max(reputation.get(id) ?? 0, total));
    }
    for (const moment of moments) {
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
    const mediaById = new Map(this.ledger?.read().map((row) => [row.id, row.media]) ?? []);
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
      const media = mediaById.get(moment.id);
      const clip =
        media?.clip.status === 'ready' && media.clip.id && media.clip.url && media.clip.thumbnailUrl
          ? { id: media.clip.id, url: media.clip.url, thumbnailUrl: media.clip.thumbnailUrl }
          : undefined;
      entry.quotes.push({
        text: moment.quote,
        occurredAt: moment.occurredAt,
        ...(clip ? { momentId: moment.id, clip } : {}),
      });
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
