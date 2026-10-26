import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { OAuthAccounts } from '../auth/oauth.js';
import { OverlayHub } from '../events/hub.js';
import { Store, RETENTION_MS } from '../store/index.js';
import { DashboardState, parseSettings } from './state.js';
import type { DashboardActions } from './state.js';
import { OFFLINE_ENVIRONMENT, setupPanel } from './setup.js';
import type { ListeningEnvironment } from './setup.js';
import type { DashboardRehearsal } from './rehearsal.js';
import type { MemoryCreditLedger } from '../ledger/index.js';
import { BASE_POINTS, WHEEL_WEIGHT_BASE, WHEEL_WEIGHT_CAP } from '../scoring/index.js';
import type { BotFilter } from '../twitch/bot-filter.js';

export function registerDashboard(
  app: FastifyInstance,
  options: {
    store: Store;
    hub: OverlayHub;
    state: DashboardState;
    accounts?: OAuthAccounts;
    actions?: DashboardActions;
    environment?: () => ListeningEnvironment;
    rehearsal: DashboardRehearsal;
    overlayConnected: () => boolean;
    ledger: MemoryCreditLedger;
    botFilter: BotFilter;
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
  app.get('/dashboard/api/state', (request, reply) => {
    const overlay = options.hub.snapshot();
    const accounts = options.accounts?.summary() ?? {};
    return reply.header('Cache-Control', 'no-store').send({
      csrf,
      historyRetentionMs: RETENTION_MS,
      activityRetentionMs: 90_000,
      accounts,
      setup: setupPanel({
        accounts,
        oauthConfigured: !!options.accounts,
        overlayUrl: `${request.protocol}://${request.headers.host}/overlay/`,
        overlayConnected: options.overlayConnected(),
        environment: options.environment?.() ?? OFFLINE_ENVIRONMENT,
      }),
      oauthConfigured: !!options.accounts,
      settings: options.state.getSettings(),
      ignoredLogins: options.botFilter.ignoredLogins(),
      creditRules: {
        basePoints: BASE_POINTS,
        weightBase: WHEEL_WEIGHT_BASE,
        weightCap: WHEEL_WEIGHT_CAP,
      },
      status: options.state.getStatus(),
      listening: options.environment?.().listening ?? false,
      winner: options.state.getWinner(),
      moments: overlay.credits.reduce((count, entry) => count + entry.momentCount, 0),
      creditedViewers: overlay.credits.length,
      creditedViewerLists: {
        current: options.hub.creditedViewers(overlay.streamId),
        recent: options.hub.creditedViewers(),
      },
      ledgerWarning: options.ledger.sizeWarning,
      durableHistory: true,
      ledgerVersion: `${options.ledger.version}:${options.store.privacyVersion}`,
      transcripts: options.state.getTranscripts(),
      activity: options.state.getActivity(),
      phase: overlay.phase,
      wheel: overlay.wheel,
      practice: {
        active: options.rehearsal.active,
        available: !options.environment?.().listening && !options.state.isReplayRunning(),
        reason: options.state.isReplayRunning()
          ? 'The automatic demo is playing (about 48 seconds). Try these buttons when it finishes.'
          : options.environment?.().listening
            ? 'Stop live listening before trying the practice buttons.'
            : 'Practice uses synthetic chat and speech. No accounts, microphone, API key or live stream needed.',
      },
      wheelStatus: !options.state.getSettings().wheelEnabled
        ? 'Live wheel disabled. Channel Points need an Affiliate or Partner channel. Enable the reward in settings after connecting both accounts. The practice wheel works without Channel Points.'
        : 'Live wheel enabled in settings. Channel Points need an Affiliate or Partner channel and a successful reward setup. Viewers redeem Enter the Credits Wheel to enter.',
    });
  });
  app.get('/dashboard/api/ledger', (_request, reply) => {
    const records = options.ledger
      .read()
      .filter((row) => !options.store.isOptedOut(row.viewerId))
      .sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
    return reply
      .header('Cache-Control', 'no-store')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .send({ records, version: `${options.ledger.version}:${options.store.privacyVersion}` });
  });
  for (const action of ['chat', 'speech', 'credits', 'spin'] as const)
    app.post(`/dashboard/api/practice/${action}`, async (request, reply) => {
      if (!authorized(request))
        return reply.code(403).send({ error: 'Dashboard request rejected' });
      if (options.environment?.().listening || options.state.isReplayRunning())
        return reply.code(409).send({
          error: 'Stop live listening or wait for the automatic demo to finish before practicing.',
        });
      const result = await options.rehearsal[action]();
      if ('error' in result) return reply.code(409).send(result);
      return result;
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
  app.post<{ Body: unknown }>('/dashboard/api/prize', async (request, reply) => {
    if (!authorized(request)) return reply.code(403).send({ error: 'Dashboard request rejected' });
    let next;
    try {
      if (
        !request.body ||
        typeof request.body !== 'object' ||
        Object.keys(request.body).some((key) => key !== 'prizeText')
      )
        throw new Error('Invalid prize');
      next = parseSettings({
        ...options.state.getSettings(),
        prizeText: (request.body as { prizeText?: unknown }).prizeText,
      });
    } catch {
      return reply.code(400).send({ error: 'Enter prize text between 1 and 120 characters' });
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
      if (action === 'disconnect') {
        const body = request.body as { role?: unknown } | null;
        const role = body?.role;
        if (role !== undefined && role !== 'streamer' && role !== 'bot')
          return reply.code(400).send({ error: 'Choose streamer or bot to disconnect' });
        if (options.actions?.disconnect) await options.actions.disconnect(role);
        else if (options.accounts) {
          for (const accountRole of role ? ([role] as const) : (['streamer', 'bot'] as const))
            options.accounts.disconnect(accountRole);
        } else return reply.code(409).send({ error: 'No Twitch accounts are connected' });
        return { ok: true };
      }
      const handler = action === 'spin' ? options.actions?.spinWheel : options.actions?.[action];
      if (action === 'start') {
        const environment = options.environment?.() ?? OFFLINE_ENVIRONMENT;
        if (environment.listening)
          return reply.code(409).send({
            error:
              'Already listening to your stream. Choose Stop listening to release the session and use practice.',
          });
        const panel = setupPanel({
          accounts: options.accounts?.summary() ?? {},
          oauthConfigured: !!options.accounts,
          overlayUrl: '',
          overlayConnected: false,
          environment,
        });
        if (!panel.canStart)
          return reply.code(409).send({
            error:
              (!options.accounts
                ? 'Twitch authorization is not configured. Connect the streamer and a separate bot account. '
                : '') + panel.steps[3]!.details.join(' '),
          });
      }
      if (!handler)
        return reply.code(409).send({ error: 'Connect and start the live channel first' });
      return (await handler()) ?? { ok: true };
    });
  }
}
