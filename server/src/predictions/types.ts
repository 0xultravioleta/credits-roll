export const FORECAST_RULES = {
  target: 3,
  defaultMinutes: 30,
  minMinutes: 10,
  maxMinutes: 60,
  bettingSeconds: 120,
  correctionSeconds: 120,
  title: 'Will chat move the stream 3+ times?',
  outcomes: ['Yes, 3 or more', 'No, fewer'],
  titleMax: 45,
  outcomeMax: 25,
  minWindow: 30,
  maxWindow: 1800,
} as const;
export type PredictionStatus = 'ACTIVE' | 'LOCKED' | 'RESOLVED' | 'CANCELED';
export interface Prediction {
  id: string;
  channelId: string;
  title: string;
  status: PredictionStatus;
  createdAt: number;
  outcomes: { id: string; title: string }[];
  winningOutcomeId?: string;
}
export interface PredictionProvider {
  list(channelId: string, id?: string, signal?: AbortSignal): Promise<Prediction[]>;
  create(channelId: string, signal?: AbortSignal): Promise<Prediction>;
  update(
    channelId: string,
    id: string,
    status: Exclude<PredictionStatus, 'ACTIVE'>,
    winningOutcomeId?: string,
    signal?: AbortSignal,
  ): Promise<Prediction>;
}
export interface ForecastView {
  phase:
    | 'idle'
    | 'creating'
    | 'counting'
    | 'correction'
    | 'canceling'
    | 'resolving'
    | 'resolved'
    | 'canceled'
    | 'uncertain';
  visible: boolean;
  canStart: boolean;
  message: string;
  count: number;
  target: number;
  endsAt: number | null;
  correctionEndsAt: number | null;
  proposed: string | null;
  source: 'live' | 'demo';
}
