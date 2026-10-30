import { expect, test } from 'vitest';
import { languageCode, resolveStreamLanguage, transcriptionLanguage } from './language.js';
import { DEFAULT_SETTINGS, parseSettings, DashboardState } from '../dashboard/state.js';
import { Store } from '../store/index.js';
import { TwitchChannelApi } from '../twitch/channel-api.js';

test('new settings use Auto and saved explicit languages survive restart', () => {
  expect(DEFAULT_SETTINGS.language).toBe('auto');
  expect(parseSettings(DEFAULT_SETTINGS).language).toBe('auto');
  const store = new Store();
  for (const language of ['en', 'es'] as const) {
    store.setSetting('settings', JSON.stringify({ ...DEFAULT_SETTINGS, language }));
    const state = new DashboardState(store);
    expect(state.getSettings().language).toBe(language);
    state.close();
  }
  store.close();
});

test('Auto reads Helix stream language; explicit settings warn on mismatch', async () => {
  const api = new TwitchChannelApi({
    request: async (_role, path, options) => {
      expect(path).toBe('streams');
      expect(options?.query).toEqual({ user_id: 'synthetic' });
      return { data: [{ id: 'stream', language: 'es' }] };
    },
  });
  const stream = await resolveStreamLanguage(() => api.liveStreamInfo('synthetic'));
  expect(transcriptionLanguage('auto', stream, 'en')).toMatchObject({
    resolved: 'es',
    source: 'stream',
    warning: null,
  });
  expect(transcriptionLanguage('en', stream).warning).toContain('differs');
  expect(transcriptionLanguage('es', stream)).toMatchObject({ resolved: 'es', warning: null });
});

test('failed, offline and invalid stream probes use environment then English', async () => {
  for (const probe of [
    async () => {
      throw new Error('unavailable');
    },
    async () => null,
    async () => ({ language: 'unknown' }),
  ]) {
    const stream = await resolveStreamLanguage(probe);
    expect(transcriptionLanguage('auto', stream, ' ES ')).toMatchObject({
      resolved: 'es',
      source: 'environment',
    });
    expect(transcriptionLanguage('auto', stream, 'auto')).toMatchObject({
      resolved: 'en',
      source: 'fallback',
    });
    expect(transcriptionLanguage('es', stream, 'en').resolved).toBe('es');
  }
  expect(languageCode('fr')).toBe('fr');
});
