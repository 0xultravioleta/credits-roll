import { expect, test, vi } from 'vitest';
import { layoutCredits } from './credits.js';
import { OverlayModel } from './state.js';
import type { CreditSummary } from '../../server/src/events/protocol.js';

test('the roll lays out every viewer and quote, sorts by points and reserves space for wrapped lines', () => {
  const entries: CreditSummary[] = [
    {
      viewer: { id: 'low', login: 'syntheticlow' },
      points: 6,
      momentCount: 1,
      kinds: ['riff'],
      quotes: [{ text: 'Name the tower Moonrise', occurredAt: Date.now() }],
    },
    {
      viewer: { id: 'high', login: 'synthetichigh' },
      points: 20,
      momentCount: 2,
      kinds: ['idea'],
      quotes: [
        { text: 'Try the northern bridge', occurredAt: Date.now() },
        { text: 'Build a glass tower', occurredAt: Date.now() },
      ],
    },
  ];
  const layout = layoutCredits(entries, (quote) => [quote, 'wrapped continuation']);
  expect(layout.rows.map((row) => row.entry.viewer.login)).toEqual([
    'synthetichigh',
    'syntheticlow',
  ]);
  expect(layout.rows[0]?.quoteLines).toContain('“Try the northern bridge”');
  expect(layout.rows[0]?.quoteLines).toContain('“Build a glass tower”');
  expect(layout.rows[1]?.quoteLines).toContain('“Name the tower Moonrise”');
  expect(layout.rows[1]!.y).toBeGreaterThan(layout.rows[0]!.y + 140 + 4 * 32);
});

test('an already rolling overlay discards expired quotes without waiting for a server event', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(1000);
    const model = new OverlayModel();
    model.accept(
      {
        type: 'snapshot',
        state: {
          streamId: 's',
          phase: 'credits',
          moments: [],
          wheel: [],
          credits: [
            {
              viewer: { id: 'v', login: 'syntheticviewer' },
              points: 10,
              momentCount: 1,
              kinds: ['idea'],
              quotes: [{ text: 'Synthetic quote', occurredAt: 1000 }],
            },
          ],
        },
      },
      0,
    );
    vi.setSystemTime(1000 + 72 * 60 * 60 * 1000);
    model.tick(1);
    expect(model.credits).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
