import { withDeadline } from '../runtime/time.js';

export const HOSTED_SHUTDOWN_MS = 20_000;
export const HOSTED_EXIT_MS = 24_000;

/** Cancel inputs immediately; finish private persistence even if remote cleanup hangs. */
export async function shutdownHosted(options: {
  stopInputs: () => Promise<void>;
  closePipeline: () => void;
  closeServer: () => Promise<void>;
  flush: () => Promise<void>;
  closeStore: () => void;
  log: (message: string) => void;
  exit: (code: number) => void;
  deadlineMs?: number;
  exitMs?: number;
}): Promise<void> {
  const deadline = options.deadlineMs ?? HOSTED_SHUTDOWN_MS;
  const hardStop = setTimeout(() => options.exit(1), options.exitMs ?? HOSTED_EXIT_MS);
  hardStop.unref();
  let failed = false;
  const guard = async (operation: () => Promise<void>, ms: number) => {
    try {
      await withDeadline(operation, ms);
    } catch {
      failed = true;
      options.log('Hosted shutdown: cleanup did not finish; review pending remote rewards.');
    }
  };
  // Keep a shared budget, reserving time for the durable log and database.
  await guard(options.stopInputs, Math.max(1, deadline - 5000));
  await guard(async () => options.closePipeline(), 100);
  await guard(async () => {
    await Promise.all([options.closeServer(), options.flush()]);
  }, 4000);
  await guard(async () => options.closeStore(), 100);
  clearTimeout(hardStop);
  // A timed-out remote operation may still own a handle. Persistence is now closed.
  options.exit(failed ? 1 : 0);
}
