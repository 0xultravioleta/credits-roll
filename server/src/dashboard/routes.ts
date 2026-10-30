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
import type { DebugLog } from '../debug/log.js';
import { MATCH_RULES } from '../matcher/rules.js';
import { channelCapabilities } from './capabilities.js';
import type { SupervisorAlerts } from '../runtime/supervisor-alert.js';
import { forgottenClipCount } from '../clips/privacy.js';
import { CLIP_RULES } from '../clips/types.js';
import type { HostedConfig } from '../hosting/config.js';
import { WHEEL_PRIZES } from '../wheel/prizes.js';
import { FORECAST_RULES } from '../predictions/types.js';

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
    debug: DebugLog;
    supervisorAlerts: SupervisorAlerts;
    hosting?: HostedConfig;
    overlayUrl?: () => string;
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
      request.headers.origin ===
        (options.hosting?.origin ?? `${request.protocol}://${request.headers.host}`)
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
      hosted: !!options.hosting,
      prizes: WHEEL_PRIZES,
      forecastRules: FORECAST_RULES,
      forecast: options.environment?.().forecast ?? null,
      forecastMoments: options.environment?.().forecastMoments ?? [],
      entriesRefunded: options.environment?.().entriesRefunded ?? 0,
      historyRetentionMs: RETENTION_MS,
      activityRetentionMs: 90_000,
      accounts,
      setup: setupPanel({
        accounts,
        oauthConfigured: !!options.accounts,
        overlayUrl:
          options.overlayUrl?.() ?? `${request.protocol}://${request.headers.host}/overlay/`,
        overlayConnected: options.overlayConnected(),
        environment: options.environment?.() ?? OFFLINE_ENVIRONMENT,
      }),
      oauthConfigured: !!options.accounts,
      settings: options.state.getSettings(),
      transcription: options.environment?.().transcription ?? null,
      supervisorAlert: options.supervisorAlerts.read(),
      clips: options.environment?.().clips ?? {
        message:
          'Live clips need a new live credit and streamer permission. Practice never creates a Twitch clip.',
        markerMessage: 'Markers need VOD storage.',
        attempted: 0,
        limit: CLIP_RULES.perStream,
        pending: 0,
      },
      forgottenClipCount: forgottenClipCount(options.store),
      capabilities: channelCapabilities(
        options.accounts,
        options.environment?.().broadcasterType ?? null,
      ),
      listeningStatus: options.environment?.().status ?? {
        autoListen: options.state.getSettings().autoListen,
        listening: options.environment?.().listening ?? false,
        phase: options.environment?.().listening ? 'listening' : 'not-listening',
        reason: options.environment?.().listening
          ? 'Live session is active.'
          : 'Live mode is not active. Practice works without a live stream.',
        lastAudioAt: null,
        lastChatAt: null,
        retry: 0,
      },
      ignoredLogins: options.botFilter.ignoredLogins(),
      debug: options.debug.status(),
      creditRules: {
        basePoints: BASE_POINTS,
        weightBase: WHEEL_WEIGHT_BASE,
        weightCap: WHEEL_WEIGHT_CAP,
      },
      matchRules: MATCH_RULES,
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
  app.post('/dashboard/api/supervisor/clear', (request, reply) => {
    if (!authorized(request)) return reply.code(403).send({ error: 'Dashboard request rejected' });
    options.supervisorAlerts.clear();
    return {
      message:
        'Saved restart-limit alert acknowledged. Current listening status is shown separately.',
    };
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
  app.post('/dashboard/api/debug/download', async (request, reply) => {
    if (!authorized(request)) return reply.code(403).send({ error: 'Dashboard request rejected' });
    await options.debug.flush();
    const content = options.debug.snapshot();
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Disposition', 'attachment; filename="credits-debug.jsonl"')
      .type('application/x-ndjson')
      .send(content);
  });
  app.post('/dashboard/api/debug/clear', async (request, reply) => {
    if (!authorized(request)) return reply.code(403).send({ error: 'Dashboard request rejected' });
    options.debug.clear();
    await options.debug.flush();
    return { message: 'Local debug log cleared.' };
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
    const saved = options.state.saveSettings(next);
    await options.actions?.settingsSaved?.();
    return saved;
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
      return reply.code(400).send({ error: 'Choose one of the four available prizes' });
    }
    await options.actions?.settingsChanged?.(next);
    return options.state.saveSettings(next);
  });
  for (const action of ['start', 'cancel', 'correct'] as const)
    app.post(`/dashboard/api/forecast/${action}`, async (request, reply) => {
      if (!authorized(request))
        return reply.code(403).send({ error: 'Dashboard request rejected' });
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return reply.code(400).send({ error: 'Invalid forecast request' });
      if (action === 'start') {
        if (
          Object.keys(body).some((key) => key !== 'minutes') ||
          !Number.isInteger(body.minutes) ||
          Number(body.minutes) < FORECAST_RULES.minMinutes ||
          Number(body.minutes) > FORECAST_RULES.maxMinutes
        )
          return reply.code(400).send({ error: 'Choose a forecast period from 10 to 60 minutes' });
        if (!options.actions?.startForecast)
          return reply.code(409).send({
            error:
              'Native forecasts need an eligible live channel. Demo and practice never call Twitch.',
          });
        await options.actions.startForecast(Number(body.minutes));
      } else if (action === 'cancel') {
        if (Object.keys(body).length)
          return reply.code(400).send({ error: 'Invalid cancellation request' });
        if (!options.actions?.cancelForecast)
          return reply.code(409).send({ error: 'No live forecast is active' });
        await options.actions.cancelForecast();
      } else {
        if (
          Object.keys(body).some((key) => !['momentId', 'excluded'].includes(key)) ||
          typeof body.momentId !== 'string' ||
          !body.momentId ||
          body.momentId.length > 128 ||
          typeof body.excluded !== 'boolean'
        )
          return reply.code(400).send({ error: 'Choose a credit and whether to exclude it' });
        if (!options.actions?.correctForecast)
          return reply.code(409).send({ error: 'No live forecast review is active' });
        await options.actions.correctForecast(body.momentId, body.excluded);
      }
      return {
        message:
          action === 'start'
            ? 'Native forecast requested. Viewers predict in Twitch for 120 seconds.'
            : action === 'cancel'
              ? 'Cancellation requested. Check the forecast status for confirmation.'
              : 'Forecast tally corrected. Recognition and reputation are unchanged.',
      };
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
