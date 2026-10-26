export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Operation aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Operation aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class OperationTimeout extends Error {
  constructor() {
    super('Operation timed out');
  }
}
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let reject!: (reason: Error) => void;
  const expired = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const abort = () => {
    controller.abort();
    reject(new Error('Operation aborted'));
  };
  const timer = setTimeout(() => {
    controller.abort();
    reject(new OperationTimeout());
  }, ms);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    return await Promise.race([
      expired,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('Operation aborted');
        return operation(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
