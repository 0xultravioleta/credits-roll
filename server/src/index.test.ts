import { expect, test, vi } from 'vitest';
import { APP_NAME, start } from './index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('has a name', () => {
  expect(APP_NAME).toBe('Credits Roll');
});

test('the real entry point starts minute counters and passes the environment language', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'credits-index-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    server = await start({
      PORT: ['3101', '3102'].includes(process.env.PORT ?? '') ? process.env.PORT : '3102',
      HOST: '127.0.0.1',
      CHAT_SOURCE: 'recorded',
      JUDGE: 'fake',
      CR_TRANSCRIPTION_LANGUAGE: 'es',
      DATABASE_PATH: join(folder, 'test.sqlite'),
      CREDITS_LEDGER_PATH: join(folder, 'ledger.jsonl'),
      CR_DEBUG_LOG_PATH: join(folder, 'debug.jsonl'),
      CR_SUPERVISOR_ALERT_PATH: join(folder, 'supervisor.json'),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const report = log.mock.calls
      .map(([line]) => String(line))
      .find((line) => line.startsWith('{'));
    expect(report).toBeDefined();
    expect(JSON.parse(report!)).toMatchObject({ language: 'es', chunks: 0, providerErrors: 0 });
  } finally {
    await server?.stop();
    vi.useRealTimers();
    log.mockRestore();
    await rm(folder, { recursive: true, force: true });
  }
});
