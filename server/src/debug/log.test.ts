import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { DebugLog, FileDebugLog, DEBUG_RETENTION_MS, DEBUG_PURGE_MS } from './log.js';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { Matcher } from '../matcher/index.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});
const chat = (id = 'one') => ({
  id,
  viewer: { id, login: 'syntheticviewer' },
  text: '🌉'.repeat(250),
  sentAt: Date.now(),
});
function file(now = Date.now, maxBytes = 20 * 1024 * 1024) {
  const directory = mkdtempSync(join(tmpdir(), 'credits-debug-'));
  cleanup.push(async () => rmSync(directory, { recursive: true }));
  const path = join(directory, 'debug-log.jsonl');
  const log = new FileDebugLog(path, process.cwd(), now, maxBytes);
  cleanup.push(() => log.close());
  return { path, log };
}

test('debug storage is bounded, local, redacted and purged at startup after 24 hours', async () => {
  let now = Date.now();
  const { path, log } = file(() => now);
  log.chat(chat(), 'ignored-bot');
  log.chat(
    {
      ...chat('redacted'),
      text: 'oauth:syntheticSecret Bearer syntheticSecret sk-syntheticSecret',
    },
    'candidate',
  );
  log.transcript({ id: 'w', streamId: 's', startAt: 0, endAt: 1, text: '🌉'.repeat(350) });
  await log.flush();
  const rows = log
    .snapshot()
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  expect(Array.from(rows[0].text)).toHaveLength(200);
  expect(Array.from(rows[2].text)).toHaveLength(300);
  expect(log.snapshot()).not.toContain('syntheticSecret');
  expect(log.status().decisions['ignored-bot']).toBe(1);
  await log.close();
  now += DEBUG_RETENTION_MS;
  const restored = new FileDebugLog(path, process.cwd(), () => now);
  cleanup.push(() => restored.close());
  await restored.flush();
  expect(restored.snapshot()).toBe('');
  expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).toBe('');
});

test('hourly purge, size cap, toggle and clear keep diagnostics temporary', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let now = Date.now();
  const { log, path } = file(() => now, 2400);
  for (let id = 0; id < 30; id++) log.chat(chat(String(id)), 'candidate');
  await log.flush();
  expect(Buffer.byteLength(readFileSync(path))).toBeLessThanOrEqual(2400);
  expect(log.status().dropped).toBeGreaterThan(0);
  log.configure(() => false);
  const before = log.snapshot();
  log.chat(chat('disabled'), 'candidate');
  expect(log.snapshot()).toBe(before);
  now += DEBUG_RETENTION_MS;
  vi.advanceTimersByTime(DEBUG_PURGE_MS);
  await log.flush();
  expect(log.snapshot()).toBe('');
  log.configure(() => true);
  log.chat(chat('again'), 'candidate');
  log.clear();
  await log.flush();
  expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).toBe('');
});

test('forgetme erases chat, associated decisions and all speech snippets even with pending appends', async () => {
  const { log, path } = file();
  log.chat(chat(), 'candidate');
  const writing = log.flush();
  log.judge({
    viewerId: 'one',
    messageId: 'one',
    kind: 'idea',
    confidence: 0.8,
    threshold: 0.75,
    kept: true,
    reason: 'kept',
  });
  log.transcript({ id: 'w', streamId: 's', startAt: 0, endAt: 1, text: 'Synthetic adopted words' });
  log.chat(chat('other'), 'candidate');
  log.forgetViewer('one');
  log.chat(chat(), 'candidate');
  await writing;
  await log.flush();
  const restored = new FileDebugLog(path, process.cwd());
  cleanup.push(() => restored.close());
  expect(restored.viewerIds()).toEqual(['other']);
  expect(restored.snapshot()).not.toContain('Synthetic adopted words');
  expect(restored.snapshot()).not.toContain('"messageId":"one"');
});

test('debug routes require CSRF and downloads exclude privacy-deleted records', async () => {
  const store = new Store();
  const { app, debug } = createApp({ store });
  cleanup.push(async () => {
    await app.close();
    store.close();
  });
  debug.chat(chat(), 'candidate');
  expect(
    (await app.inject({ method: 'POST', url: '/dashboard/api/debug/download' })).statusCode,
  ).toBe(403);
  const csrf = (await app.inject('/dashboard/api/state')).json().csrf;
  store.optOut('one');
  const response = await app.inject({
    method: 'POST',
    url: '/dashboard/api/debug/download',
    headers: { 'x-credits-csrf': csrf },
  });
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe('');
  debug.chat(chat('other'), 'candidate');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/dashboard/api/debug/clear',
        headers: { 'x-credits-csrf': csrf },
      })
    ).statusCode,
  ).toBe(200);
  expect(debug.snapshot()).toBe('');
});

test('judge decisions record confidence, threshold and reasons without provider payloads', async () => {
  const log = new DebugLog();
  cleanup.push(() => log.close());
  const matcher = new Matcher(
    { judge: async () => [{ messageId: 'one', kind: 'idea', confidence: 0.5 }] },
    undefined,
    () => 0.8,
    (event) => log.judge(event),
  );
  const now = Date.now();
  await matcher.match(
    { id: 'w', streamId: 's', startAt: now, endAt: now, text: 'Synthetic adoption' },
    [{ ...chat(), sentAt: now - 1 }],
  );
  expect(JSON.parse(log.snapshot())).toMatchObject({
    type: 'judge',
    confidence: 0.5,
    threshold: 0.8,
    reason: 'below-threshold',
    kept: false,
  });
});
