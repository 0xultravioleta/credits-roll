import { expect, test } from 'vitest';
import { WHEEL_PRIZES, rewardPrompt } from './prizes.js';
import { DashboardState, DEFAULT_SETTINGS, parseSettings } from '../dashboard/state.js';
import { Store } from '../store/index.js';

test.each(WHEEL_PRIZES)('only an approved wheel prize can be saved: %s', (prizeText) => {
  expect(parseSettings({ ...DEFAULT_SETTINGS, prizeText }).prizeText).toBe(prizeText);
  expect(rewardPrompt(prizeText, true)).toContain(
    'Credited this stream? Your entry is refunded. 1 winner per stream.',
  );
});
test.each(['Cash', 'Crypto', 'Gift card', 'Physical prize', 'Free text', ''])(
  'rejects an unlisted prize: %s',
  (prizeText) => {
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, prizeText })).toThrow();
  },
);
test('saved legacy free-text prize migrates to the approved default and the free-entry toggle defaults on', () => {
  const store = new Store();
  store.setSetting(
    'settings',
    JSON.stringify({ ...DEFAULT_SETTINGS, prizeText: 'Legacy free text' }),
  );
  const state = new DashboardState(store);
  try {
    expect(state.getSettings().prizeText).toBe('Pick the next challenge');
    expect(state.getSettings().creditedViewersEnterFree).toBe(true);
  } finally {
    state.close();
    store.close();
  }
});
