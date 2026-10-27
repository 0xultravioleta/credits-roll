import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { HostedConfig } from './config.js';

const SESSION_COOKIE = '__Host-cr_session';
const SESSION_SECONDS = 12 * 60 * 60;
export function equalSecret(a: string, b: string): boolean {
  // Compare fixed-size digests, including when input lengths differ.
  const digest = (value: string) =>
    createHmac('sha256', 'credits-roll-compare').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}
export class HostedSecurity {
  private readonly buckets = new Map<string, { start: number; count: number }>();
  constructor(
    readonly config: HostedConfig,
    private readonly now: () => number = Date.now,
  ) {}
  private signature(value: string): string {
    return createHmac('sha256', this.config.sessionSecret).update(value).digest('base64url');
  }
  sessionCookie(): string {
    const payload = Buffer.from(
      JSON.stringify({
        user: this.config.allowedUserId,
        expires: this.now() + SESSION_SECONDS * 1000,
      }),
    ).toString('base64url');
    return `${SESSION_COOKIE}=${payload}.${this.signature(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
  }
  authenticated(request: Pick<FastifyRequest, 'headers'>): boolean {
    const cookies = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
    if (cookies.length !== 1) return false;
    const value = cookies[0]!.slice(SESSION_COOKIE.length + 1);
    if (value.length > 1024) return false;
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra || !equalSecret(signature, this.signature(payload)))
      return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return (
        data.user === this.config.allowedUserId &&
        typeof data.expires === 'number' &&
        data.expires > this.now() &&
        data.expires <= this.now() + SESSION_SECONDS * 1000
      );
    } catch {
      return false;
    }
  }
  overlayUrl(): string {
    const url = new URL('/overlay/', this.config.origin);
    url.searchParams.set('token', this.config.overlayToken);
    return url.href;
  }
  install(app: FastifyInstance): void {
    app.addHook('onRequest', async (request, reply) => {
      reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header('Strict-Transport-Security', 'max-age=31536000')
        .header('Cache-Control', 'no-store');
      const url = new URL(request.raw.url ?? '/', 'http://local');
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      if (path === '/health') return;
      // Use the original Host, never X-Forwarded-Host, for this allowlist.
      if (request.headers.host?.toLowerCase() !== this.config.host.toLowerCase())
        return reply.code(403).send({ error: 'Host not allowed' });
      if (request.protocol !== 'https') return reply.code(403).send({ error: 'HTTPS is required' });
      if (path.startsWith('/auth/') || path.startsWith('/dashboard/api/')) {
        const now = this.now();
        for (const [key, bucket] of this.buckets)
          if (now - bucket.start >= 60_000) this.buckets.delete(key);
        const key = `${request.ip}:${path.startsWith('/auth/') ? 'auth' : 'dashboard'}`;
        let bucket = this.buckets.get(key);
        if (!bucket) {
          if (this.buckets.size >= 10_000)
            return reply
              .code(429)
              .header('Retry-After', '60')
              .send({ error: 'Try again in one minute' });
          bucket = { start: now, count: 0 };
          this.buckets.set(key, bucket);
        }
        if (++bucket.count > 60)
          return reply
            .code(429)
            .header('Retry-After', '60')
            .send({ error: 'Try again in one minute' });
      }
      if (path === '/dashboard' || path.startsWith('/dashboard/')) {
        if (!this.authenticated(request)) {
          if (path === '/dashboard') return reply.redirect('/auth/login');
          return reply.code(401).send({ error: 'Sign in as the allowed streamer' });
        }
      }
      if (
        path === '/overlay' ||
        path.startsWith('/overlay/') ||
        ['/events', '/api/state', '/wheel'].includes(path)
      ) {
        const values = url.searchParams.getAll('token');
        if (values.length !== 1 || !equalSecret(values[0]!, this.config.overlayToken))
          return reply.code(404).send({ error: 'Not found' });
        reply.header(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://*.jtvnw.net https://*.twitch.tv; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
      }
      if (path.startsWith('/dev/')) return reply.code(404).send({ error: 'Not found' });
    });
  }
}
