import type { CreditQuote, Moment, MomentKind, Reputation, Viewer } from '../domain.js';
import type { ForecastView } from '../predictions/types.js';

export interface CreditSummary {
  viewer: Viewer;
  momentCount: number;
  points: number;
  kinds: MomentKind[];
  quotes?: CreditQuote[];
}

export interface OverlayState {
  forecast?: ForecastView | null;
  phase: 'live' | 'credits';
  streamId: string;
  moments: Moment[];
  credits: CreditSummary[];
  wheel: (Reputation & { weight: number })[];
}

export type OverlayEvent =
  | { type: 'forecast'; forecast: ForecastView | null }
  | { type: 'clip'; moment: Moment }
  | { type: 'reset' }
  | { type: 'snapshot'; state: OverlayState }
  | { type: 'moment'; moment: Moment }
  | { type: 'optout'; viewerId: string };
