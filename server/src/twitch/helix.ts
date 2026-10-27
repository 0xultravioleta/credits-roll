import { setTimeout as delay } from 'node:timers/promises';
import type { OAuthAccounts } from '../auth/oauth.js';
import { AuthorizationRejected } from '../auth/oauth.js';
import type { AccountRole } from '../auth/types.js';

export class TwitchApiError extends Error {
  constructor(readonly status: number) {
    super(`Twitch request failed (HTTP ${status})`);
  }
}
export interface HelixRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}
export interface TwitchApi {
  request(role: AccountRole, path: string, options?: HelixRequest): Promise<unknown>;
}

export class Helix implements TwitchApi {
  constructor(
    private readonly accounts: Pick<OAuthAccounts, 'config' | 'accessToken'>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly wait: (ms: number, signal?: AbortSignal) => Promise<void> = async (
      ms,
      signal,
    ) => {
      await delay(ms, undefined, { signal });
    },
    private readonly shutdownSignal?: AbortSignal,
  ) {}
  async request(role: AccountRole, path: string, options: HelixRequest = {}): Promise<unknown> {
    const signals = [options.signal, this.shutdownSignal].filter(
      (value): value is AbortSignal => !!value,
    );
    if (signals.length) options = { ...options, signal: AbortSignal.any(signals) };
    const url = new URL(`https://api.twitch.tv/helix/${path}`);
    if (url.origin !== 'https://api.twitch.tv' || !url.pathname.startsWith('/helix/'))
      throw new Error('Invalid Twitch API path');
    url.search = new URLSearchParams(options.query).toString();
    let refreshed = false;
    let limited = false;
    for (;;) {
      options.signal?.throwIfAborted();
      let response: Response;
      try {
        const token = await this.accounts.accessToken(role);
        options.signal?.throwIfAborted();
        response = await this.fetcher(url, {
          method: options.method ?? 'GET',
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
          headers: {
            'Client-Id': this.accounts.config.clientId,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
      } catch (error) {
        if (error instanceof AuthorizationRejected) throw error;
        throw new Error('Twitch request unavailable');
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await this.accounts.accessToken(role, true);
        continue;
      }
      if (response.status === 429 && !limited) {
        limited = true;
        const seconds =
          Number(response.headers.get('retry-after')) ||
          Math.max(1, Number(response.headers.get('ratelimit-reset')) - Date.now() / 1000);
        if (!Number.isFinite(seconds) || seconds > 30) throw new TwitchApiError(429);
        await this.wait(Math.max(1000, Math.ceil(seconds * 1000)), options.signal);
        continue;
      }
      if (!response.ok) throw new TwitchApiError(response.status);
      if (response.status === 204) return undefined;
      try {
        return await response.json();
      } catch {
        throw new Error('Invalid Twitch response');
      }
    }
  }
}
