import type { CreditQuote, Moment, MomentKind, Reputation, Viewer } from '../domain.js';

export interface CreditSummary {
  viewer: Viewer;
  momentCount: number;
  points: number;
  kinds: MomentKind[];
  quotes?: CreditQuote[];
}

export interface OverlayState {
  phase: 'live' | 'credits';
  streamId: string;
  moments: Moment[];
  credits: CreditSummary[];
  wheel: (Reputation & { weight: number })[];
}

export type OverlayEvent =
  | { type: 'reset' }
  | { type: 'snapshot'; state: OverlayState }
  | { type: 'moment'; moment: Moment }
  | { type: 'optout'; viewerId: string };
