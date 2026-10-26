import { expect, test } from 'vitest';
import { creditsAsText, explainRewards } from '../../public/dashboard.js';
import { BASE_POINTS, WHEEL_WEIGHT_BASE, WHEEL_WEIGHT_CAP } from '../scoring/index.js';

test('reward copy uses the scoring constants, the saved prize and an honest description of non-cash rewards', () => {
  const copy = explainRewards(
    { basePoints: BASE_POINTS, weightBase: WHEEL_WEIGHT_BASE, weightCap: WHEEL_WEIGHT_CAP },
    'Choose the next challenge',
  ).join(' ');
  expect(copy).toContain(`idea starts at ${BASE_POINTS.idea}`);
  expect(copy).toContain(`assist at ${BASE_POINTS.assist}`);
  expect(copy).toContain(`riff at ${BASE_POINTS.riff}`);
  expect(copy).toContain(`cap the result at ${WHEEL_WEIGHT_CAP}`);
  expect(copy).toContain('Choose the next challenge');
  expect(copy).toContain('Nothing is paid');
  const changed = explainRewards(
    { basePoints: { idea: 11, assist: 9, riff: 7 }, weightBase: 2, weightCap: 25 },
    'Pick a map',
  ).join(' ');
  expect(changed).toContain('idea starts at 11');
  expect(changed).toContain('add 2');
  expect(changed).toContain('Pick a map');
});

test('copying history includes the viewer, awarded points, confidence and both source texts', () => {
  const copy = creditsAsText([
    {
      viewer: { id: 'v', login: 'syntheticviewer' },
      points: 8,
      wheelWeight: 3,
      momentCount: 1,
      lastCreditedAt: 1000,
      moments: [
        {
          quote: '<synthetic suggestion>',
          adoptionExcerpt: 'Synthetic spoken adoption.',
          kind: 'assist',
          confidence: 0.95,
          pointsEarned: 8,
          occurredAt: 1000,
        },
      ],
    },
  ]);
  expect(copy).toContain('@syntheticviewer | 8 reputation | weight 3');
  expect(copy).toContain('Chat: <synthetic suggestion>');
  expect(copy).toContain('confidence 95% | 8 points');
  expect(copy).toContain('Streamer said: Synthetic spoken adoption.');
  expect(creditsAsText([])).toContain('Try the simulation');
});
