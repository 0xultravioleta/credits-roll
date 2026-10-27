export interface Viewer {
  id: string;
  login: string;
}

export interface ChatMessage {
  botLike?: boolean;
  id: string;
  viewer: Viewer;
  text: string;
  sentAt: number;
}

export interface TranscriptWindow {
  timing?: 'chunk';
  id: string;
  streamId: string;
  startAt: number;
  endAt: number;
  text: string;
}

export const MOMENT_KINDS = ['idea', 'assist', 'riff'] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

export interface MatchedMoment {
  viewer: Viewer;
  messageId: string;
  quote: string;
  kind: MomentKind;
  confidence: number;
}

export interface Moment extends MatchedMoment {
  media?: import('./clips/types.js').MomentMedia;
  id: string;
  streamId: string;
  occurredAt: number;
  adoptionExcerpt?: string;
  pointsEarned?: number;
}

export interface Reputation {
  viewer: Viewer;
  points: number;
  momentCount: number;
}

export interface CreditQuote {
  momentId?: string;
  clip?: import('./clips/types.js').PublishedClip;
  text: string;
  occurredAt: number;
}
