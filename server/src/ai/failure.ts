import { OperationTimeout, withDeadline } from '../runtime/time.js';
export const OPENAI_TIMEOUT_MS = 30_000;

export type ProviderStage = 'transcription' | 'embeddings' | 'judge';
export type ProviderReason = 'request-failed' | 'timeout' | 'http-429' | 'http-5xx' | 'http-4xx';
// Carry only app-owned metadata. Never attach the original error, response or cause.
export class OpenAIRequestFailure extends Error {
  constructor(
    readonly retryable: boolean,
    readonly reason: ProviderReason,
  ) {
    super('OpenAI request failed');
  }
}
export class ProviderFailure extends Error {
  constructor(
    readonly stage: ProviderStage,
    readonly retryable: boolean,
    readonly reason: ProviderReason,
  ) {
    super(
      stage === 'transcription'
        ? 'Transcription provider failed or timed out'
        : 'Matching provider failed or timed out',
    );
  }
}
export const PROVIDER_FAILURE_LIMIT = 3;
export class ProviderSessionStopped extends Error {
  constructor(
    readonly failure: ProviderFailure,
    readonly consecutive: number,
  ) {
    super(
      failure.retryable
        ? `Listening stopped after ${consecutive} consecutive provider failures. Check provider availability and billing.`
        : 'Listening stopped: provider rejected the request. Check API authorization, model and language settings.',
    );
  }
}
export async function providerOperation<T>(
  stage: ProviderStage,
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await withDeadline(operation, OPENAI_TIMEOUT_MS, signal);
  } catch (error) {
    if (signal?.aborted) throw new Error('Operation aborted');
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure(
      stage,
      error instanceof OpenAIRequestFailure ? error.retryable : true,
      error instanceof OpenAIRequestFailure
        ? error.reason
        : error instanceof OperationTimeout
          ? 'timeout'
          : 'request-failed',
    );
  }
}
