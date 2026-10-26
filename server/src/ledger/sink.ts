import type { CreditRecord } from './index.js';

/** Synchronous local boundary. Implementations must not send credit evidence over a network. */
export interface CreditSink {
  onCredit(record: CreditRecord): void;
}
