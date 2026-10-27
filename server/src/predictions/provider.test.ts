import { expect, test, vi } from 'vitest';
import { HelixPredictionProvider, FakePredictionProvider } from './provider.js';
import { FORECAST_RULES } from './types.js';
import type { HelixRequest } from '../twitch/helix.js';

test('Helix prediction requests create, list, lock, resolve and cancel with documented fields', async () => {
  let status = 'ACTIVE';
  const request = vi.fn(async (_role: string, _path: string, options?: HelixRequest) => {
    status = String(options?.body?.status ?? status);
    return {
      data: [
        {
          id: 'prediction',
          broadcaster_id: 'channel',
          title: FORECAST_RULES.title,
          created_at: '2026-10-27T12:00:00Z',
          status,
          winning_outcome_id: options?.body?.winning_outcome_id ?? null,
          outcomes: FORECAST_RULES.outcomes.map((title, index) => ({
            id: `outcome-${index}`,
            title,
            top_predictors: [{ user_login: 'not-retained' }],
          })),
        },
      ],
    };
  });
  const provider = new HelixPredictionProvider({ request });
  expect(FORECAST_RULES.title).toHaveLength(35);
  await provider.create('channel');
  expect(request).toHaveBeenLastCalledWith(
    'streamer',
    'predictions',
    expect.objectContaining({
      method: 'POST',
      body: {
        broadcaster_id: 'channel',
        title: FORECAST_RULES.title,
        outcomes: FORECAST_RULES.outcomes.map((title) => ({ title })),
        prediction_window: 120,
      },
    }),
  );
  expect(JSON.stringify(await provider.list('channel'))).not.toContain('not-retained');
  await provider.update('channel', 'prediction', 'LOCKED');
  await provider.update('channel', 'prediction', 'RESOLVED', 'outcome-0');
  expect(request).toHaveBeenLastCalledWith(
    'streamer',
    'predictions',
    expect.objectContaining({
      body: {
        broadcaster_id: 'channel',
        id: 'prediction',
        status: 'RESOLVED',
        winning_outcome_id: 'outcome-0',
      },
    }),
  );
  await provider.update('channel', 'prediction', 'CANCELED');
  expect(request).toHaveBeenLastCalledWith(
    'streamer',
    'predictions',
    expect.objectContaining({
      body: { broadcaster_id: 'channel', id: 'prediction', status: 'CANCELED' },
    }),
  );
  await expect(provider.update('channel', 'prediction', 'RESOLVED')).rejects.toThrow();
});
test('fake predictions stay offline, enforce one open prediction and model terminal transitions', async () => {
  const provider = new FakePredictionProvider(() => 1000);
  const row = await provider.create('channel');
  await expect(provider.create('channel')).rejects.toThrow();
  await provider.update('channel', row.id, 'LOCKED');
  await provider.update('channel', row.id, 'RESOLVED', row.outcomes[0]!.id);
  await expect(provider.update('channel', row.id, 'CANCELED')).rejects.toThrow();
  const next = await provider.create('channel');
  expect((await provider.update('channel', next.id, 'CANCELED')).status).toBe('CANCELED');
});
