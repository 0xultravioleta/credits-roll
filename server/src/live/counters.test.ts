import { expect, test, vi } from 'vitest';
import { COUNTER_INTERVAL_MS, LiveCounters } from './counters.js';
import { Pipeline } from '../pipeline.js';
import { Matcher } from '../matcher/index.js';
import { FakeJudge } from '../matcher/fake-judge.js';
import { FakeTranscriber } from '../ai/fake.js';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';

test('minute reports contain cumulative counters and bounded reasons, with no source data', async () => {
  vi.useFakeTimers();
  const lines: string[] = [];
  let language = 'es';
  let threshold = 0.75;
  const counters = new LiveCounters(
    () => language,
    () => threshold,
    (line) => lines.push(line),
  );
  const store = new Store();
  const { app, hub, scoring } = createApp({ store });
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    counters,
    transcriber: new FakeTranscriber(),
    matcher: new Matcher(
      new FakeJudge(),
      undefined,
      () => threshold,
      undefined,
      undefined,
      counters,
    ),
  });
  try {
    counters.start();
    counters.start();
    const now = Date.now();
    pipeline.addChat({
      id: 'private-message-id',
      viewer: { id: 'private-viewer-id', login: 'private_viewer' },
      text: 'Prueba el puente del norte',
      sentAt: now - 2000,
    });
    pipeline.addChat({
      id: 'service',
      viewer: { id: 'bot', login: 'Nightbot' },
      text: 'private bot output',
      sentAt: now - 1000,
    });
    counters.increment('chunks');
    await pipeline.processWindow({
      id: 'private-window',
      streamId: 'private-stream',
      startAt: now - 1000,
      endAt: now,
      text: 'Buena idea, pruebo el puente del norte.',
      language: 'es',
    });
    counters.increment('providerErrors');
    counters.reason('match', 'private untrusted reason');
    await vi.advanceTimersByTimeAsync(COUNTER_INTERVAL_MS);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      chunks: 1,
      transcriptsNonEmpty: 1,
      chatIn: 2,
      candidates: 1,
      judgeCalls: 1,
      kept: 1,
      providerErrors: 1,
      byReason: { 'chat:candidate': 1, 'chat:ignored-bot': 1, 'match:kept': 1, 'match:other': 1 },
      language: 'es',
      threshold: 0.75,
    });
    expect(lines[0]).not.toMatch(/private|puente|buena|Nightbot/i);
    language = 'en';
    threshold = 0.7;
    await vi.advanceTimersByTimeAsync(COUNTER_INTERVAL_MS);
    expect(JSON.parse(lines[1]!)).toMatchObject({ language: 'en', threshold: 0.7, kept: 1 });
    counters.close();
    await vi.advanceTimersByTimeAsync(COUNTER_INTERVAL_MS);
    expect(lines).toHaveLength(2);
  } finally {
    counters.close();
    pipeline.close();
    await app.close();
    store.close();
    vi.useRealTimers();
  }
});
