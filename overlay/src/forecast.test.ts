import { expect, test } from 'vitest';
import { forecastCard } from './forecast.js';
import { OverlayModel } from './state.js';
import type { ForecastView } from '../../server/src/predictions/types.js';
const view: ForecastView = {
  phase: 'counting',
  visible: true,
  canStart: false,
  message: '',
  count: 2,
  target: 3,
  endsAt: 1_120_000,
  correctionEndsAt: null,
  proposed: null,
  source: 'live',
};
test('forecast cards use server counts and timestamps and never display a payout amount', () => {
  expect(forecastCard(view, 0)).toBe('Chat forecast 2/3 · 18:40 left');
  expect(forecastCard({ ...view, phase: 'resolved' }, 0)).toBeNull();
  expect(forecastCard({ ...view, visible: false }, 0)).toBeNull();
  expect(forecastCard({ ...view, source: 'demo' }, 0)).toContain('Demo forecast');
});
test('SSE forecast updates do not replay a credit and reset clears the card', () => {
  const model = new OverlayModel();
  model.accept({ type: 'forecast', forecast: view }, 0);
  expect(model.forecast?.count).toBe(2);
  expect(model.current).toBeUndefined();
  model.accept({ type: 'reset' }, 1);
  expect(model.forecast).toBeNull();
});
