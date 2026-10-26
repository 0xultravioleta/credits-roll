import { describe, expect, test } from 'vitest';
import type { ChatMessage, TranscriptWindow } from '../domain.js';
import { FakeEmbeddings } from '../ai/fake.js';
import { FakeJudge } from './fake-judge.js';
import { cosine, LOOKBACK_MS, Matcher } from './index.js';
import { negativeFixtures, positiveFixtures } from './fixtures.js';

const startAt = 1_000_000;
const window = (text: string): TranscriptWindow => ({
  id: 'window',
  streamId: 'stream',
  startAt,
  endAt: startAt + 5000,
  text,
});
const chat = (text: string): ChatMessage => ({
  id: 'chat',
  viewer: { id: 'viewer', login: 'mapmaker' },
  text,
  sentAt: startAt - 2000,
});
const matcher = new Matcher(new FakeJudge(), new FakeEmbeddings());

describe('deterministic matcher fixtures', () => {
  test.each(positiveFixtures)('credits $name', async (fixture) => {
    const result = await matcher.match(window(fixture.transcript), [chat(fixture.chat)]);
    expect(result).toEqual([
      {
        viewer: { id: 'viewer', login: 'mapmaker' },
        messageId: 'chat',
        quote: fixture.chat,
        kind: fixture.kind,
        confidence: expect.any(Number),
      },
    ]);
  });
  test.each(negativeFixtures)('does not credit $name', async (fixture) => {
    expect(await matcher.match(window(fixture.transcript), [chat(fixture.chat)])).toEqual([]);
  });
});

test('requires chat before the response and within the lookback', async () => {
  const row = chat('Try the northern bridge');
  const response = window("Good idea, I'll try the northern bridge.");
  expect(await matcher.match(response, [{ ...row, sentAt: startAt + 1 }])).toEqual([]);
  expect(await matcher.match(response, [{ ...row, sentAt: startAt - LOOKBACK_MS - 1 }])).toEqual(
    [],
  );
  expect(await matcher.match(response, [{ ...row, sentAt: startAt - LOOKBACK_MS }])).toHaveLength(
    1,
  );
});

test('keeps the earliest copy under the explicit default duplicate policy', async () => {
  const row = chat('Try the northern bridge');
  expect(
    await matcher.match(window("Good idea, I'll try the northern bridge."), [
      row,
      { ...row, id: 'other', viewer: { id: 'other', login: 'other' } },
    ]),
  ).toMatchObject([{ messageId: 'chat', viewer: row.viewer }]);
});

test('validates judge output, deduplicates ids and takes quotes only from canonical chat', async () => {
  const row = chat('Try the northern bridge');
  const custom = new Matcher({
    judge: async () => [
      { messageId: 'invented', kind: 'idea', confidence: 1 },
      { messageId: 'chat', kind: 'idea', confidence: 0.2 },
      { messageId: 'chat', kind: 'idea', confidence: NaN },
      { messageId: 'chat', kind: 'idea', confidence: 0.9 },
      { messageId: 'chat', kind: 'idea', confidence: 1 },
    ],
  });
  expect(await custom.match(window('adoption evidence'), [row])).toEqual([
    { viewer: row.viewer, messageId: row.id, quote: row.text, kind: 'idea', confidence: 0.9 },
  ]);
});

test('cosine handles zero and incompatible vectors', () => {
  expect(cosine([0], [0])).toBe(0);
  expect(cosine([1], [1, 2])).toBe(0);
  expect(cosine([1, 0], [1, 0])).toBe(1);
});
