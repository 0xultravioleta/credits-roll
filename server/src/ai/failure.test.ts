import { expect, test, vi } from 'vitest';
import { OpenAIClient } from './openai.js';
import { OpenAIRequestFailure, providerOperation, ProviderFailure } from './failure.js';

test.each([429, 500, 503, 401, 400])(
  'HTTP %s retains only safe recovery metadata',
  async (status) => {
    const client = new OpenAIClient(
      'synthetic',
      async () => new Response('private payload', { status }),
    );
    const error = await providerOperation('judge', (signal) =>
      client.post('chat/completions', {}, signal),
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({ stage: 'judge', retryable: status === 429 || status >= 500 });
    expect(JSON.stringify(error)).not.toContain('private payload');
    expect((error as Error).stack).not.toContain('synthetic');
  },
);

test('deadline aborts a hanging provider and tags it as a transient timeout', async () => {
  vi.useFakeTimers();
  try {
    let requestSignal!: AbortSignal;
    const operation = providerOperation('transcription', (signal) => {
      requestSignal = signal;
      return new Promise(() => undefined);
    });
    const rejected = expect(operation).rejects.toMatchObject({
      retryable: true,
      reason: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(requestSignal.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test('explicit Stop is cancellation rather than a counted provider failure', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    providerOperation(
      'judge',
      async () => {
        throw new OpenAIRequestFailure(true, 'http-429');
      },
      controller.signal,
    ),
  ).rejects.toThrow('Operation aborted');
});
