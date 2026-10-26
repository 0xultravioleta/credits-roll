import { expect, test } from 'vitest';
import { adoptionExcerpt, shortExcerpt } from './excerpt.js';

test('selects the adopting sentence from canonical text rather than an unrelated introduction', () => {
  const adoption = "Good idea, I'll try the northern bridge.";
  expect(
    adoptionExcerpt('Unrelated words. '.repeat(40) + adoption, 'Try the northern bridge'),
  ).toBe(adoption);
  expect(
    adoptionExcerpt(
      'Charla de prueba. Buena idea, vamos por el puente del norte.',
      'Prueba el puente del norte',
    ),
  ).toBe('Buena idea, vamos por el puente del norte.');
});

test('caps and normalizes evidence without adding text that the streamer never said', () => {
  expect(Array.from(shortExcerpt('🌉 '.repeat(210)))).toHaveLength(200);
  expect(shortExcerpt('  Good\r\n idea. ')).toBe('Good idea.');
  expect(adoptionExcerpt('', 'Try the bridge')).toBe('');
});
