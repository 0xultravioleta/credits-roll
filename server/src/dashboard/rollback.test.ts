import { expect, test } from 'vitest';
import { Store } from '../store/index.js';
import { DashboardState, DEFAULT_SETTINGS, parseSettings } from './state.js';

test('R3: Auto saves a legacy-compatible settings row and restores Auto separately', () => {
  const store = new Store();
  const dashboard = new DashboardState(store);
  dashboard.saveSettings({ ...DEFAULT_SETTINGS, language: 'auto' });
  const row = JSON.parse(store.getSetting('settings')!);
  // 88f97d2 accepts these fields with only en/es; extra fields are rejected.
  expect(['en', 'es']).toContain(row.language);
  expect(Object.keys(row).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  expect(() => parseSettings(row)).not.toThrow();
  const restored = new DashboardState(store);
  expect(restored.getSettings().language).toBe('auto');
  restored.close();
  dashboard.close();
  store.close();
});

test('migrates turn 11 Auto on startup and preserves explicit saved languages', () => {
  const store = new Store();
  store.setSetting('settings', JSON.stringify({ ...DEFAULT_SETTINGS, language: 'auto' }));
  const dashboard = new DashboardState(store);
  expect(dashboard.getSettings().language).toBe('auto');
  expect(JSON.parse(store.getSetting('settings')!).language).toBe('en');
  dashboard.saveSettings({ ...DEFAULT_SETTINGS, language: 'es' });
  dashboard.saveSettings({ ...DEFAULT_SETTINGS, language: 'auto' });
  expect(JSON.parse(store.getSetting('settings')!).language).toBe('es');
  dashboard.saveSettings({ ...DEFAULT_SETTINGS, language: 'en' });
  const restored = new DashboardState(store);
  expect(restored.getSettings().language).toBe('en');
  restored.close();
  dashboard.close();
  store.close();
});

test('settings row and Auto mode commit atomically', () => {
  const store = new Store();
  const dashboard = new DashboardState(store);
  dashboard.saveSettings({ ...DEFAULT_SETTINGS, language: 'es' });
  const before = store.getSetting('settings');
  const original = store.setSetting.bind(store);
  store.setSetting = (key, value) => {
    if (key === 'transcription-language-mode') throw new Error('synthetic write failure');
    original(key, value);
  };
  expect(() => dashboard.saveSettings({ ...DEFAULT_SETTINGS, language: 'auto' })).toThrow(
    'write failure',
  );
  expect(store.getSetting('settings')).toBe(before);
  expect(dashboard.getSettings().language).toBe('es');
  dashboard.close();
  store.close();
});
