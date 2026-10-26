import { workerData } from 'node:worker_threads';
import { writeSync } from 'node:fs';
import { HealthWatchdog, WATCHDOG_RULES } from './watchdog.js';

const url = new URL(workerData.healthUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/health')
  throw new Error('Watchdog requires the local health endpoint');
const watchdog = new HealthWatchdog({
  now: Date.now,
  timeoutMs: workerData.timing.healthTimeoutMs,
  probeMs: workerData.timing.probeMs,
  probe: async (signal) => {
    const response = await fetch(url, { signal, cache: 'no-store' });
    return response.ok && ((await response.json()) as { status?: unknown }).status === 'ok';
  },
  // Write directly: worker stdout forwarding can be blocked by a stalled main thread.
  log: (message) => {
    writeSync(2, message + '\n');
  },
  // Worker process.exit only exits the worker. This signal terminates this shared Node PID.
  exit: () => {
    process.kill(process.pid, 'SIGKILL');
  },
});
setInterval(() => {
  void watchdog.tick();
}, workerData.timing.tickMs ?? WATCHDOG_RULES.tickMs);
void watchdog.tick();
