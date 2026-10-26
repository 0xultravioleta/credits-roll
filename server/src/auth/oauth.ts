import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { object, validLogin } from '../twitch/source.js';
import { SCOPES } from './types.js';
import type {
  AccountRole,
  Accounts,
  AccountToken,
  OAuthConfig,
  OAuthTransport,
  TokenGrant,
  TokenIdentity,
  TokenStorage,
} from './types.js';

export class AuthorizationRejected extends Error {
  constructor() {
    super('Twitch authorization rejected');
  }
}

export function authorizationUrl(config: OAuthConfig, role: AccountRole, state: string): string {
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: SCOPES[role].join(' '),
    state,
    force_verify: 'true',
  }).toString();
  return url.href;
}

export class OAuthStates {
  private readonly pending = new Map<
    string,
    { role: AccountRole; browser: string; expires: number }
  >();
  constructor(private readonly now: () => number = Date.now) {}
  issue(role: AccountRole, browser: string): string {
    for (const [key, value] of this.pending)
      if (value.expires <= this.now()) this.pending.delete(key);
    if (this.pending.size >= 100) throw new Error('Too many authorization attempts');
    const state = randomBytes(32).toString('hex');
    this.pending.set(state, { role, browser, expires: this.now() + 600_000 });
    return state;
  }
  consume(state: string, browser: string): AccountRole {
    const entry = this.pending.get(state);
    this.pending.delete(state);
    const a = Buffer.from(entry?.browser ?? '');
    const b = Buffer.from(browser);
    if (
      !entry ||
      entry.expires <= this.now() ||
      !a.length ||
      a.length !== b.length ||
      !timingSafeEqual(a, b)
    )
      throw new Error('Authorization state rejected');
    return entry.role;
  }
}

export class TwitchOAuthTransport implements OAuthTransport {
  constructor(
    private readonly config: OAuthConfig,
    private readonly request: typeof fetch = fetch,
  ) {}
  private async grant(parameters: Record<string, string>): Promise<TokenGrant> {
    try {
      const response = await this.request('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          ...parameters,
        }),
      });
      if (!response.ok) throw new Error();
      const row = object(await response.json());
      if (
        typeof row.access_token !== 'string' ||
        !row.access_token ||
        typeof row.refresh_token !== 'string' ||
        !row.refresh_token ||
        typeof row.expires_in !== 'number' ||
        row.expires_in <= 0 ||
        !Array.isArray(row.scope) ||
        row.scope.some((scope: unknown) => typeof scope !== 'string')
      )
        throw new Error();
      return {
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresIn: row.expires_in,
        scopes: row.scope as string[],
      };
    } catch {
      throw new Error('Twitch authorization request failed');
    }
  }
  exchange(code: string): Promise<TokenGrant> {
    return this.grant({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
    });
  }
  refresh(refreshToken: string): Promise<TokenGrant> {
    return this.grant({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }
  async validate(accessToken: string): Promise<TokenIdentity> {
    try {
      const response = await this.request('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401) throw new AuthorizationRejected();
      if (!response.ok) throw new Error();
      const row = object(await response.json());
      if (
        typeof row.client_id !== 'string' ||
        typeof row.user_id !== 'string' ||
        !validLogin(row.login) ||
        !Array.isArray(row.scopes) ||
        row.scopes.some((scope: unknown) => typeof scope !== 'string') ||
        typeof row.expires_in !== 'number' ||
        row.expires_in <= 0
      )
        throw new Error();
      return {
        clientId: row.client_id,
        userId: row.user_id,
        login: row.login,
        scopes: row.scopes as string[],
        expiresIn: row.expires_in,
      };
    } catch (error) {
      if (error instanceof AuthorizationRejected) throw error;
      throw new Error('Twitch token validation failed');
    }
  }
}

export class OAuthAccounts {
  private accounts: Accounts;
  private readonly pending = new Map<AccountRole, Promise<AccountToken>>();
  constructor(
    readonly config: OAuthConfig,
    private readonly storage: TokenStorage,
    private readonly transport: OAuthTransport,
    private readonly now: () => number = Date.now,
  ) {
    this.accounts = storage.read();
  }
  summary() {
    return Object.fromEntries(
      Object.entries(this.accounts).map(([role, value]) => [
        role,
        { id: value.userId, login: value.login },
      ]),
    );
  }
  identity(role: AccountRole): { id: string; login: string } | undefined {
    const value = this.accounts[role];
    return value ? { id: value.userId, login: value.login } : undefined;
  }
  async authorize(role: AccountRole, code: string): Promise<void> {
    const grant = await this.transport.exchange(code);
    const identity = await this.transport.validate(grant.accessToken);
    this.save(role, grant, identity);
  }
  private save(role: AccountRole, grant: TokenGrant, identity: TokenIdentity): AccountToken {
    const other = this.accounts[role === 'streamer' ? 'bot' : 'streamer'];
    if (
      identity.clientId !== this.config.clientId ||
      !SCOPES[role].every((scope) => identity.scopes.includes(scope)) ||
      other?.userId === identity.userId ||
      (this.accounts[role] && this.accounts[role]!.userId !== identity.userId)
    )
      throw new Error('Account or scopes rejected; disconnect before switching accounts');
    const token = {
      ...grant,
      scopes: identity.scopes,
      userId: identity.userId,
      login: identity.login,
      expiresAt: this.now() + identity.expiresIn * 1000,
    };
    const next = { ...this.accounts, [role]: token };
    this.storage.write(next);
    this.accounts = next;
    return token;
  }
  async accessToken(role: AccountRole, forceRefresh = false): Promise<string> {
    const current = this.accounts[role];
    if (!current) throw new Error('Connect the Twitch account first');
    if (!forceRefresh && current.expiresAt > this.now() + 60_000) return current.accessToken;
    let operation = this.pending.get(role);
    if (!operation) {
      operation = (async () => {
        const grant = await this.transport.refresh(current.refreshToken);
        const identity = await this.transport.validate(grant.accessToken);
        return this.save(role, grant, identity);
      })();
      this.pending.set(role, operation);
      void operation.finally(() => this.pending.delete(role)).catch(() => undefined);
    }
    return (await operation).accessToken;
  }
  async validateAll(): Promise<void> {
    for (const role of ['streamer', 'bot'] as const) {
      const token = this.accounts[role];
      if (!token) continue;
      try {
        const identity = await this.transport.validate(await this.accessToken(role));
        this.save(role, this.accounts[role]!, identity);
      } catch (error) {
        if (error instanceof AuthorizationRejected) {
          this.disconnect(role);
          throw new Error('Twitch account disconnected; authorize again');
        }
        throw new Error('Twitch validation unavailable; try again');
      }
    }
  }
  disconnect(role: AccountRole): void {
    const next = { ...this.accounts };
    delete next[role];
    this.storage.write(next);
    this.accounts = next;
  }
}

export function registerOAuth(
  app: FastifyInstance,
  accounts: OAuthAccounts,
  onConnected: () => void = () => undefined,
): void {
  const states = new OAuthStates();
  const secure = new URL(accounts.config.redirectUri).protocol === 'https:' ? '; Secure' : '';
  app.get<{ Querystring: { role?: string } }>('/auth/login', (request, reply) => {
    const role = request.query.role ?? 'streamer';
    if (role !== 'streamer' && role !== 'bot')
      return reply.code(400).send({ error: 'Invalid account role' });
    const browser = randomBytes(32).toString('hex');
    const state = states.issue(role, browser);
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Set-Cookie',
      `cr_oauth=${browser}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600${secure}`,
    );
    return reply.redirect(authorizationUrl(accounts.config, role, state));
  });
  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>(
    '/auth/callback',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
      reply.header(
        'Set-Cookie',
        `cr_oauth=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0${secure}`,
      );
      try {
        const browser =
          request.headers.cookie
            ?.split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith('cr_oauth='))
            ?.slice(9) ?? '';
        const role = states.consume(request.query.state ?? '', browser);
        if (request.query.error || !request.query.code || request.query.code.length > 2048)
          throw new Error();
        await accounts.authorize(role, request.query.code);
        onConnected();
        return reply.redirect('/dashboard?auth=connected');
      } catch {
        return reply.redirect('/dashboard?auth=failed');
      }
    },
  );
}
