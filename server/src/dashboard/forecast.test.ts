import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { forecastLabel } from '../../public/dashboard.js';
import { FORECAST_RULES } from '../predictions/types.js';
import type { ForecastView } from '../predictions/types.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function setup() {
  const store = new Store();
  const actions = {
    startForecast: vi.fn(async () => {}),
    cancelForecast: vi.fn(async () => {}),
    correctForecast: vi.fn(async () => {}),
  };
  const { app } = createApp({ store, actions });
  cleanup.push(async () => {
    await app.close();
    store.close();
  });
  return { app, actions };
}
test('forecast endpoints require CSRF, validate periods/corrections and invoke only injected actions', async () => {
  const { app, actions } = setup();
  const state = (await app.inject('/dashboard/api/state')).json();
  const post = (action: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/dashboard/api/forecast/${action}`,
      payload,
      headers: { 'x-credits-csrf': state.csrf },
    });
  expect(state.forecastRules).toEqual(FORECAST_RULES);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dashboard/api/forecast/start',
        payload: { minutes: 30 },
      })
    ).statusCode,
  ).toBe(403);
  for (const minutes of [9, 61, 30.5, '30'])
    expect((await post('start', { minutes })).statusCode).toBe(400);
  expect((await post('start', { minutes: 30 })).statusCode).toBe(200);
  expect(actions.startForecast).toHaveBeenCalledWith(30);
  expect((await post('correct', { momentId: 'credit', excluded: true })).statusCode).toBe(200);
  expect(actions.correctForecast).toHaveBeenCalledWith('credit', true);
  expect((await post('correct', { momentId: 'credit', excluded: 'yes' })).statusCode).toBe(400);
  expect((await post('cancel', {})).statusCode).toBe(200);
  expect(actions.cancelForecast).toHaveBeenCalledOnce();
});
test('forecast labels show counts, bounded timers, review and explicit offline illustration', () => {
  const row: ForecastView = {
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
  expect(forecastLabel(row, 0)).toBe('Chat forecast 2/3 · 18:40 left');
  expect(forecastLabel({ ...row, phase: 'correction', correctionEndsAt: 120_000 }, 0)).toContain(
    '2:00 to correct',
  );
  expect(forecastLabel({ ...row, source: 'demo' }, 0)).toContain('no Twitch points');
});
