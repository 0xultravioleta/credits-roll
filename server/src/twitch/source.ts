import type { ChatMessage } from '../domain.js';

export type ChatHandler = (message: ChatMessage) => void | Promise<void>;

export interface ChatSource {
  run(onMessage: ChatHandler, signal: AbortSignal): Promise<void>;
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export function validLogin(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_]{1,25}$/.test(value);
}
