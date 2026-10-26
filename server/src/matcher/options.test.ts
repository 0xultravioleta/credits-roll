import { afterEach, expect, test, vi } from 'vitest';
import { Matcher } from './index.js';
import { FakeJudge } from './fake-judge.js';
import { DEFAULT_MATCH_OPTIONS, MATCH_RULES, messageOrder } from './rules.js';
import { DEFAULT_SETTINGS, DashboardState, parseSettings } from '../dashboard/state.js';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { Pipeline } from '../pipeline.js';
import { FakeTranscriber } from '../ai/fake.js';
import { OpenAIClient } from '../ai/openai.js';
import { OpenAIJudge } from './openai-judge.js';
import { explainMatching } from '../../public/dashboard.js';

afterEach(() => vi.useRealTimers());
const now = 1_000_000;
const window = {
  id: 'w',
  streamId: 's',
  startAt: now,
  endAt: now + 5000,
  text: "Good idea, I'll try the northern bridge.",
};
const message = {
  id: 'm',
  viewer: { id: 'v', login: 'syntheticviewer' },
  text: 'Try the northern bridge',
  sentAt: now - 1,
};

test.each([
  [0.69, 0.7, 0],
  [0.7, 0.7, 1],
  [0.6, 0.6, 1],
  [0.59, 0.6, 0],
])(
  'judge confidence %s with saved threshold %s produces %s moments',
  async (confidence, threshold, count) => {
    const matcher = new Matcher(
      { judge: async () => [{ messageId: 'm', kind: 'idea', confidence }] },
      undefined,
      () => threshold,
    );
    expect(await matcher.match(window, [message])).toHaveLength(count);
  },
);
test.each(['lol', '+1', 'f', 'Go north', '123456789012'])(
  'short reaction %s cannot earn credit',
  async (text) => {
    const judge = {
      judge: vi.fn(async () => [{ messageId: 'm', kind: 'idea' as const, confidence: 1 }]),
    };
    expect(await new Matcher(judge).match(window, [{ ...message, text }])).toEqual([]);
    expect(judge.judge).not.toHaveBeenCalled();
  },
);
test('duplicates keep the chronologically first long copy or reject all, according to the saved policy', async () => {
  const later = {
    ...message,
    id: 'later',
    sentAt: now - 1,
    viewer: { id: 'later', login: 'syntheticlater' },
  };
  const earlier = { ...message, id: 'earlier', sentAt: now - 2, text: message.text.toUpperCase() };
  expect(await new Matcher(new FakeJudge()).match(window, [later, earlier])).toMatchObject([
    { messageId: 'earlier' },
  ]);
  const strict = new Matcher(new FakeJudge(), undefined, undefined, undefined, () => ({
    ...DEFAULT_MATCH_OPTIONS,
    duplicatePolicy: 'reject-all',
  }));
  expect(await strict.match(window, [later, earlier])).toEqual([]);
});
test('lookback settings use the audio-window boundary and allow the configured 180 seconds', async () => {
  const row = { ...message, sentAt: now - 120_000 };
  expect(await new Matcher(new FakeJudge()).match(window, [row])).toEqual([]);
  const extended = new Matcher(new FakeJudge(), undefined, undefined, undefined, () => ({
    ...DEFAULT_MATCH_OPTIONS,
    lookbackSeconds: 180,
  }));
  expect(await extended.match(window, [row])).toHaveLength(1);
  expect(await extended.match(window, [{ ...row, sentAt: now - 180_001 }])).toEqual([]);
});
test('the 10-second tail is off by default, explicitly ordered, riff-only and capped', async () => {
  const row = { ...message, sentAt: now + 10_000 };
  expect(await new Matcher(new FakeJudge()).match(window, [row])).toEqual([]);
  const audit = vi.fn();
  const options = () => ({ ...DEFAULT_MATCH_OPTIONS, allowAfterReply: true });
  const weak = new Matcher(new FakeJudge(), undefined, () => 0.6, audit, options);
  expect(await weak.match(window, [row])).toMatchObject([
    { kind: 'riff', confidence: MATCH_RULES.tailConfidenceCap },
  ]);
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      ordering: 'streamer spoke first',
      reason: 'kept-weak-streamer-first',
      deltaMs: 10_000,
      threshold: 0.6,
    }),
  );
  expect(await weak.match(window, [{ ...row, sentAt: now + 10_001 }])).toEqual([]);
  expect(
    await new Matcher(new FakeJudge(), undefined, undefined, undefined, options).match(window, [
      row,
    ]),
  ).toEqual([]);
  const causal = new Matcher(
    { judge: async () => [{ messageId: 'm', kind: 'idea', confidence: 1 }] },
    undefined,
    () => 0.6,
    undefined,
    options,
  );
  expect(await causal.match(window, [row])).toEqual([]);
  expect(messageOrder({ ...window, timing: 'chunk' }, { ...row, sentAt: now + 1 }).ordering).toBe(
    'order uncertain within audio chunk',
  );
});
test('the actual JSON judge prompt labels both orders without sending viewer identities', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: '{"moments":[]}' } }],
      }),
    );
  const judge = new OpenAIJudge(new OpenAIClient('synthetic-key', request));
  await judge.judge(window, [message, { ...message, id: 'late', sentAt: now + 1 }]);
  const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
  expect(body.messages[0].content).toContain('CANNOT have caused');
  expect(
    JSON.parse(body.messages[1].content).chat.map((row: { ordering: string }) => row.ordering),
  ).toEqual(['viewer spoke first', 'streamer spoke first']);
  expect(body.messages[1].content).not.toContain('syntheticviewer');
});
test('settings validate new ranges, migrate old confidence and explain the real constants', () => {
  for (const patch of [
    { confidenceThreshold: 0.59 },
    { confidenceThreshold: 0.91 },
    { lookbackSeconds: 29 },
    { lookbackSeconds: 181 },
    { duplicatePolicy: 'guess' },
  ])
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, ...patch })).toThrow();
  const store = new Store();
  store.setSetting(
    'settings',
    JSON.stringify({
      language: 'en',
      confidenceThreshold: 1,
      quietMode: true,
      wheelEnabled: false,
      prizeText: 'Synthetic prize',
    }),
  );
  const state = new DashboardState(store);
  try {
    expect(state.getSettings()).toMatchObject({
      confidenceThreshold: 0.9,
      lookbackSeconds: 90,
      duplicatePolicy: 'keep-first',
      allowAfterReply: false,
    });
    expect(explainMatching(MATCH_RULES, DEFAULT_SETTINGS).join(' ')).toContain(
      'Saved confidence threshold: 0.70',
    );
  } finally {
    state.close();
    store.close();
  }
});
test('the live pipeline waits for the optional tail and Stop cancels a pending tail', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const store = new Store();
  const { app, hub, scoring } = createApp({ store });
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    transcriber: new FakeTranscriber(),
    matcher: new Matcher(
      new FakeJudge(),
      undefined,
      () => 0.6,
      undefined,
      () => ({ ...DEFAULT_MATCH_OPTIONS, allowAfterReply: true }),
    ),
    allowAfterReply: () => true,
  });
  try {
    const processing = pipeline.processWindow(window);
    await vi.advanceTimersByTimeAsync(5000);
    pipeline.addChat({ ...message, sentAt: Date.now() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await processing).toHaveLength(1);
    const waiting = pipeline.processWindow({ ...window, startAt: Date.now(), endAt: Date.now() });
    await Promise.resolve();
    pipeline.clearChat();
    expect(await waiting).toEqual([]);
  } finally {
    pipeline.close();
    vi.useRealTimers();
    await app.close();
    store.close();
  }
});
