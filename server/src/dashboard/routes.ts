import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { OAuthAccounts } from '../auth/oauth.js';
import { OverlayHub } from '../events/hub.js';
import { Store } from '../store/index.js';
import { DashboardState, parseSettings } from './state.js';
import type { DashboardActions } from './state.js';

export function registerDashboard(
  app: FastifyInstance,
  options: {
    store: Store;
    hub: OverlayHub;
    state: DashboardState;
    accounts?: OAuthAccounts;
    actions?: DashboardActions;
  },
) {
  const csrf = randomBytes(32).toString('hex');
  const authorized = (request: FastifyRequest): boolean => {
    const value = request.headers['x-credits-csrf'];
    if (typeof value !== 'string') return false;
    const a = Buffer.from(csrf);
    const b = Buffer.from(value);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    return (
      !request.headers.origin ||
      request.headers.origin === `${request.protocol}://${request.headers.host}`
    );
  };
  app.get('/dashboard', (_request, reply) =>
    reply
      .header('Cache-Control', 'no-store')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      )
      .header('Referrer-Policy', 'no-referrer')
      .type('text/html')
      .send(readFileSync(new URL('../../public/dashboard.html', import.meta.url), 'utf8')),
  );
  for (const [route, filename, type] of [
    ['/dashboard/app.js', 'dashboard.js', 'text/javascript'],
    ['/dashboard/style.css', 'dashboard.css', 'text/css'],
  ] as const)
    app.get(route, (_request, reply) =>
      reply
        .type(type)
        .send(readFileSync(new URL(`../../public/${filename}`, import.meta.url), 'utf8')),
    );
  app.get('/dashboard/api/state', (_request, reply) => {
    const overlay = options.hub.snapshot();
    return reply.header('Cache-Control', 'no-store').send({
      csrf,
      accounts: options.accounts?.summary() ?? {},
      oauthConfigured: !!options.accounts,
      settings: options.state.getSettings(),
      status: options.state.getStatus(),
      winner: options.state.getWinner(),
      moments: options.store.getMoments(overlay.streamId).length,
      creditedViewers: overlay.credits.length,
      transcripts: options.state.getTranscripts(),
      phase: overlay.phase,
      wheel: overlay.wheel,
    });
  });
  app.post<{ Body: unknown }>('/dashboard/api/settings', async (request, reply) => {
    if (!authorized(request)) return reply.code(403).send({ error: 'Dashboard request rejected' });
    let next;
    try {
      next = parseSettings(request.body);
    } catch {
      return reply.code(400).send({ error: 'Invalid settings' });
    }
    await options.actions?.settingsChanged?.(next);
    return options.state.saveSettings(next);
  });
  for (const action of ['credits', 'spin', 'start', 'stop', 'disconnect'] as const) {
    app.post(`/dashboard/api/${action}`, async (request, reply) => {
      if (!authorized(request))
        return reply.code(403).send({ error: 'Dashboard request rejected' });
      if (action === 'credits') {
        if (options.actions?.rollCredits) return await options.actions.rollCredits();
        options.hub.rollCredits(options.hub.snapshot().streamId);
        return { ok: true };
      }
      const handler = action === 'spin' ? options.actions?.spinWheel : options.actions?.[action];
      if (!handler)
        return reply.code(409).send({ error: 'Connect and start the live channel first' });
      return (await handler()) ?? { ok: true };
    });
  }
}
