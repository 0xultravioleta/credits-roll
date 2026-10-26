import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from './app.js';
import { createProviders } from './ai/providers.js';
import { Matcher } from './matcher/index.js';
import type { Judge, Judgment } from './matcher/judge.js';
import { Pipeline } from './pipeline.js';
import { Store } from './store/index.js';
import { DEMO_STREAM_ID, replayDemo } from './demo/recording.js';
import { runDemo } from './demo.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.unstubAllGlobals();
});
function setup(judge?: Judge) {
  const store = new Store();
  const { app, hub, scoring } = createApp({ store });
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    transcriber: providers.transcriber,
    matcher: new Matcher(judge ?? providers.judge, providers.embeddings),
  });
  cleanup.push(async () => {
    pipeline.close();
    await app.close();
    store.close();
  });
  return { pipeline, store, hub, scoring };
}

test('replays the whole synthetic timeline with no network, preserving attribution and opt-outs', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Unexpected external request');
  });
  const { pipeline, store, hub, scoring } = setup();
  const moments = await replayDemo({
    pipeline,
    signal: new AbortController().signal,
    realtime: false,
  });
  expect(moments.map((moment) => [moment.viewer.login, moment.kind])).toEqual([
    ['mapmaker', 'idea'],
    ['switchwitch', 'assist'],
    ['punpilot', 'riff'],
    ['mapmaker', 'idea'],
    ['mixcraft', 'assist'],
  ]);
  expect(store.isOptedOut('viewer-quiet')).toBe(true);
  expect(store.getMoments()).toHaveLength(5);
  expect(
    scoring.wheelEntries().map((entry) => [entry.viewer.login, entry.points, entry.weight]),
  ).toEqual([
    ['mapmaker', 20, 5],
    ['mixcraft', 8, 3],
    ['switchwitch', 8, 3],
    ['punpilot', 6, 3],
  ]);
  hub.rollCredits(DEMO_STREAM_ID);
  expect(hub.snapshot().phase).toBe('credits');
  expect(hub.snapshot().credits).toHaveLength(4);
});

test('opt-out during an in-flight judge prevents storage and publication', async () => {
  let finish!: (rows: Judgment[]) => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const judge: Judge = {
    judge: () => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const { pipeline, store } = setup(judge);
  const now = Date.now();
  const message = {
    id: 'chat',
    viewer: { id: 'viewer', login: 'mapmaker' },
    text: 'Try the northern bridge',
    sentAt: now - 1000,
  };
  pipeline.addChat(message);
  const processing = pipeline.processWindow({
    id: 'window',
    streamId: 'stream',
    startAt: now - 500,
    endAt: now,
    text: "I'll try the northern bridge",
  });
  await startedPromise;
  pipeline.addChat({ ...message, id: 'optout', text: '!optout' });
  finish([{ messageId: 'chat', kind: 'idea', confidence: 0.95 }]);
  expect(await processing).toEqual([]);
  expect(store.getReputation()).toEqual([]);
});

test('serializes overlapping windows and awards a source message only once', async () => {
  const { pipeline } = setup();
  const now = Date.now();
  pipeline.addChat({
    id: 'chat',
    viewer: { id: 'viewer', login: 'mapmaker' },
    text: 'Try the northern bridge',
    sentAt: now - 1000,
  });
  const window = {
    id: 'w',
    streamId: 'stream',
    startAt: now - 500,
    endAt: now,
    text: "Good idea, I'll try the northern bridge",
  };
  const results = await Promise.all([
    pipeline.processWindow(window),
    pipeline.processWindow({ ...window, id: 'other' }),
  ]);
  expect(results.map((rows) => rows.length)).toEqual([1, 0]);
});

test('finite demo smoke run completes offline even when fetch is unavailable', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Unexpected external request');
  });
  const output: string[] = [];
  const result = await runDemo({
    once: true,
    port: 0,
    log: (line) => {
      output.push(line);
    },
  });
  expect(result.moments).toHaveLength(5);
  expect(output).toContain('Offline smoke run complete.');
});
