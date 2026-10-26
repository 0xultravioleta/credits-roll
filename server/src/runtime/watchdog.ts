import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { withDeadline } from './time.js';

export const WATCHDOG_RULES = {
  healthTimeoutMs: 90_000,
  probeMs: 5000,
  tickMs: 5000,
  lagIntervalMs: 60_000,
  lagWarnMs: 500,
} as const;
export class HealthWatchdog {
  private lastGood: number;
  private pending = false;
  private failed = false;
  constructor(
    private readonly options: {
      now: () => number;
      probe: (signal: AbortSignal) => Promise<boolean>;
      log: (message: string) => void;
      exit: () => void;
      timeoutMs?: number;
      probeMs?: number;
    },
  ) {
    this.lastGood = options.now();
  }
  async tick(): Promise<void> {
    if (this.failed) return;
    if (
      this.options.now() - this.lastGood >=
      (this.options.timeoutMs ?? WATCHDOG_RULES.healthTimeoutMs)
    ) {
      this.failed = true;
      this.options.log(
        'WATCHDOG: /health has not answered for ' +
          (this.options.timeoutMs ?? WATCHDOG_RULES.healthTimeoutMs) / 1000 +
          ' seconds. Exiting non-zero for supervisor restart.',
      );
      this.options.exit();
      return;
    }
    if (this.pending) return;
    this.pending = true;
    try {
      if (await withDeadline(this.options.probe, this.options.probeMs ?? WATCHDOG_RULES.probeMs))
        this.lastGood = this.options.now();
    } catch {
      /* No response does not reset the healthy timestamp. */
    } finally {
      this.pending = false;
    }
  }
}

export function reportLag(maxMs: number, p99Ms: number, log: (message: string) => void): void {
  if (maxMs > WATCHDOG_RULES.lagWarnMs)
    log('Event-loop lag: max ' + Math.round(maxMs) + ' ms; p99 ' + Math.round(p99Ms) + ' ms.');
}

export interface WatchdogTiming {
  healthTimeoutMs: number;
  probeMs: number;
  tickMs: number;
}
export function startWatchdog(
  healthUrl: string,
  log: (message: string) => void = console.error,
  timing: WatchdogTiming = WATCHDOG_RULES,
): () => Promise<void> {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const lagTimer = setInterval(() => {
    reportLag(histogram.max / 1e6, histogram.percentile(99) / 1e6, log);
    histogram.reset();
  }, WATCHDOG_RULES.lagIntervalMs);
  lagTimer.unref();
  const suffix = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const worker = new Worker(new URL('./watchdog-worker' + suffix, import.meta.url), {
    workerData: { healthUrl, timing },
    ...(suffix === '.ts' ? { execArgv: ['--import', 'tsx'] } : {}),
  });
  let closing = false;
  worker.on('error', () => {
    if (!closing) {
      log('WATCHDOG: monitor failed. Exiting non-zero.');
      process.exit(1);
    }
  });
  worker.on('exit', () => {
    if (!closing) {
      log('WATCHDOG: monitor stopped unexpectedly.');
      process.exit(1);
    }
  });
  worker.unref();
  return async () => {
    closing = true;
    clearInterval(lagTimer);
    histogram.disable();
    await worker.terminate();
  };
}
