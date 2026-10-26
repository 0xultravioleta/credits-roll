import type { Moment, MomentKind } from '../domain.js';
import { MIN_CONFIDENCE } from '../matcher/index.js';

export const BASE_POINTS: Readonly<Record<MomentKind, number>> = { idea: 10, assist: 8, riff: 6 };
export const WHEEL_WEIGHT_BASE = 1;
export const WHEEL_WEIGHT_CAP = 20;

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
    ? Math.min(WHEEL_WEIGHT_CAP, WHEEL_WEIGHT_BASE + Math.floor(Math.sqrt(points)))
    : 0;
}
