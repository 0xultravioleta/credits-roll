import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { Moment, TranscriptWindow } from './domain.js';
import { MOMENT_KINDS } from './domain.js';
import { OverlayHub, encodeSse } from './events/hub.js';
import { Scoring } from './scoring/index.js';
import { Store } from './store/index.js';
import { OAuthAccounts, registerOAuth } from './auth/oauth.js';
import { DashboardState } from './dashboard/state.js';
import type { DashboardActions } from './dashboard/state.js';
import type { ListeningEnvironment } from './dashboard/setup.js';
import { registerDashboard } from './dashboard/routes.js';
import { DashboardRehearsal } from './dashboard/rehearsal.js';
import { MemoryCreditLedger, creditRecord } from './ledger/index.js';
import type { CreditContext } from './ledger/index.js';
import { DashboardActionError } from './dashboard/action-error.js';
import { BotFilter, parseIgnoredLogins } from './twitch/bot-filter.js';
import { DebugLog } from './debug/log.js';
import { SupervisorAlerts } from './runtime/supervisor-alert.js';
import { forgetCreditMedia } from './clips/privacy.js';
import type { HostedConfig } from './hosting/config.js';
import { HostedSecurity } from './hosting/security.js';

export function createApp(options: {
  store: Store;
  enableDev?: boolean;
  mode?: string;
  overlayRoot?: string;
  onTranscript?: (window: TranscriptWindow) => Promise<Moment[]>;
  accounts?: OAuthAccounts;
  onConnected?: () => void;
  dashboard?: DashboardState;
  actions?: DashboardActions;
  environment?: () => ListeningEnvironment;
  ledger?: MemoryCreditLedger;
  creditContext?: () => CreditContext;
  ignoredLogins?: readonly string[];
  debug?: DebugLog;
  supervisorAlerts?: SupervisorAlerts;
  hosting?: HostedConfig;
}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 32_768,
    trustProxy: !!options.hosting,
    forceCloseConnections: options.hosting ? true : undefined,
  });
  const security = options.hosting ? new HostedSecurity(options.hosting) : undefined;
  security?.install(app);
  const ledger = options.ledger ?? new MemoryCreditLedger();
  const debug = options.debug ?? new DebugLog();
  for (const id of debug.viewerIds()) if (options.store.isOptedOut(id)) debug.forgetViewer(id);
  const context = options.creditContext ?? (() => ({ channelId: 'local', judgeModel: 'unknown' }));
  for (const id of new Set(
    ledger
      .read()
      .filter((row) => options.store.isOptedOut(row.viewerId))
      .map((row) => row.viewerId),
  ))
    forgetCreditMedia(options.store, ledger, id);
  const detachPrivacy = options.store.onOptOut((viewerId) => {
    debug.forgetViewer(viewerId);
    forgetCreditMedia(options.store, ledger, viewerId);
  });
  // A restart cannot prove what happened to an in-flight remote creation. Preserve
  // its ID if known, mark it uncertain and never replay a create request.
  for (const row of ledger.read())
    if (row.media && ['creating', 'confirming'].includes(row.media.clip.status))
      ledger.updateMedia(row.id, {
        ...row.media,
        clip: { ...row.media.clip, status: 'pending-unconfirmed' },
      });
  for (const moment of options.store.getMoments())
    ledger.append(
      creditRecord(moment, moment.pointsEarned ?? 0, {
        ...context(),
        judgeModel: 'legacy-unknown',
      }),
    );
  const scoring = new Scoring(options.store, ledger, context);
  // A hard watchdog exit may land between the ledger rename and SQLite commit.
  // Replay retained ledger records idempotently without publishing another pop-up.
  for (const row of ledger.read())
    options.store.recordMoment(
      {
        id: row.id,
        streamId: row.streamId,
        messageId: row.sourceMessageId,
        viewer: { id: row.viewerId, login: row.login },
        quote: row.quote,
        adoptionExcerpt: row.adoptionExcerpt,
        occurredAt: Date.parse(row.time),
        kind: row.kind,
        confidence: row.confidence,
      },
      row.points,
    );
  const clients = new Set<ServerResponse>();
  const dashboard = options.dashboard ?? new DashboardState(options.store);
  debug.configure(() => dashboard.getSettings().debugLog);
  const botFilter = new BotFilter(
    () => [
      ...dashboard.getSettings().ignoredLogins,
      ...parseIgnoredLogins(options.ignoredLogins ?? []),
    ],
    () => Object.values(options.accounts?.summary() ?? {}),
  );
  const hub = new OverlayHub(options.store, scoring, (event) => {
    if (event.type === 'moment') dashboard.moment(event.moment);
    if (event.type === 'optout' || event.type === 'reset') dashboard.clearTranscripts();
    if (event.type === 'reset') dashboard.setWinner(undefined);
  });
  const rehearsal = new DashboardRehearsal(hub, dashboard, Date.now, botFilter, debug);
  app.addHook('onRequest', async (request, reply) => {
    if (security) return;
    try {
      const host = new URL(`http://${request.headers.host ?? ''}`).hostname;
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
        return reply.code(403).send({ error: 'Use the local server address' });
    } catch {
      return reply.code(400).send({ error: 'Invalid host' });
    }
  });
  registerDashboard(app, {
    store: options.store,
    hub,
    state: dashboard,
    accounts: options.accounts,
    actions: options.actions,
    environment: options.environment,
    rehearsal,
    overlayConnected: () => clients.size > 0,
    ledger,
    botFilter,
    debug,
    supervisorAlerts: options.supervisorAlerts ?? new SupervisorAlerts(),
    hosting: options.hosting,
    overlayUrl: security ? () => security.overlayUrl() : undefined,
  });
  if (options.accounts) registerOAuth(app, options.accounts, options.onConnected, security);
  else
    app.get('/auth/login', (_request, reply) =>
      reply.code(503).send({ error: 'Configure the Twitch application to connect accounts' }),
    );
  const overlayRoot =
    options.overlayRoot ?? fileURLToPath(new URL('../../overlay/dist/', import.meta.url));
  if (existsSync(overlayRoot)) {
    if (security) {
      const overlayIndex = (_request: unknown, reply: import('fastify').FastifyReply) => {
        const query = new URL(security.overlayUrl()).search;
        const html = readFileSync(join(overlayRoot, 'index.html'), 'utf8').replace(
          /((?:src|href)="\/overlay\/[^"?]+)(")/g,
          `$1${query}$2`,
        );
        return reply.type('text/html').send(html);
      };
      app.get('/overlay/', overlayIndex);
      app.get('/overlay/index.html', overlayIndex);
    }
    app.register(fastifyStatic, {
      root: overlayRoot,
      prefix: '/overlay/',
      index: ['index.html'],
      redirect: true,
    });
  }
  app.get('/overlay', (_request, reply) =>
    reply.redirect(security ? security.overlayUrl() : '/overlay/'),
  );
  app.get('/demo/clip-thumbnail.svg', (_request, reply) =>
    reply
      .header('Cache-Control', 'no-store')
      .type('image/svg+xml')
      .send(readFileSync(new URL('../public/demo-clip.svg', import.meta.url), 'utf8')),
  );
  app.get('/demo/clip/:id', (_request, reply) =>
    reply
      .header(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self'; frame-ancestors 'none'",
      )
      .header('Referrer-Policy', 'no-referrer')
      .type('text/html')
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Demo clip - not on Twitch</title><h1>Demo clip - not on Twitch</h1><p>This is a local illustration. No Twitch clip or video was created.</p><img src="/demo/clip-thumbnail.svg" width="480" height="270" alt="Demo clip - not on Twitch"><p><a href="/dashboard">Return to the dashboard</a></p></html>',
      ),
  );
  app.get('/', (_request, reply) =>
    reply
      .type('text/html')
      .send(readFileSync(new URL('../../server/public/index.html', import.meta.url), 'utf8')),
  );
  app.get('/health', () => ({
    status: 'ok',
    mode: options.mode ?? 'local',
    autoListen: dashboard.getSettings().autoListen,
    listening:
      options.environment?.().status?.listening ?? options.environment?.().listening ?? false,
    lastAudioAt: options.environment?.().status?.lastAudioAt ?? null,
    lastChatAt: options.environment?.().status?.lastChatAt ?? null,
  }));
  app.get('/api/state', () => hub.snapshot());
  app.get('/wheel', () => ({ entries: scoring.wheelEntries() }));

  app.get('/events', (request, reply) => {
    if (clients.size >= 20)
      return reply.code(503).send({ error: 'Overlay connection limit reached' });
    reply.hijack();
    const response = reply.raw;
    for (const [name, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined) response.setHeader(name, value);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write('retry: 2000\n\n');
    clients.add(response);
    const unsubscribe = hub.subscribe((event) => {
      if (response.destroyed) return;
      // A stalled OBS client must reconnect rather than accumulate private data in memory.
      if (!response.write(encodeSse(event))) response.destroy();
    });
    const heartbeat = setInterval(() => {
      if (!response.destroyed && !response.write(': keepalive\n\n')) response.destroy();
    }, 15_000);
    heartbeat.unref();
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      clients.delete(response);
    };
    request.raw.once('close', cleanup);
    response.once('close', cleanup);
  });

  if (options.enableDev && !security) {
    if (options.onTranscript) {
      app.post<{ Body: TranscriptWindow }>(
        '/dev/transcript',
        {
          schema: {
            body: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'streamId', 'startAt', 'endAt', 'text'],
              properties: {
                id: { type: 'string', minLength: 1, maxLength: 128 },
                streamId: { type: 'string', minLength: 1, maxLength: 100 },
                startAt: { type: 'integer', minimum: 0 },
                endAt: { type: 'integer', minimum: 0 },
                text: { type: 'string', minLength: 1, maxLength: 16_000 },
              },
            },
          },
        },
        async (request) => ({ moments: await options.onTranscript!(request.body) }),
      );
    }
    app.post<{
      Body: {
        viewer: string;
        quote: string;
        kind?: Moment['kind'];
        confidence?: number;
        streamId?: string;
      };
    }>(
      '/dev/moment',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['viewer', 'quote'],
            properties: {
              viewer: { type: 'string', pattern: '^[a-zA-Z0-9_]{1,25}$' },
              quote: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
              kind: { type: 'string', enum: MOMENT_KINDS },
              confidence: { type: 'number', minimum: 0.75, maximum: 1 },
              streamId: { type: 'string', minLength: 1, maxLength: 100 },
            },
          },
        },
      },
      (request, reply) => {
        const body = request.body;
        const moment: Moment = {
          id: randomUUID(),
          messageId: randomUUID(),
          streamId: body.streamId ?? 'rehearsal',
          viewer: { id: `dev:${body.viewer.toLowerCase()}`, login: body.viewer.toLowerCase() },
          quote: body.quote,
          kind: body.kind ?? 'idea',
          confidence: body.confidence ?? 0.95,
          occurredAt: Date.now(),
        };
        if (!scoring.credit(moment))
          return reply.code(409).send({ error: 'Moment was not accepted' });
        hub.publishMoment(moment);
        return reply.code(201).send({ moment });
      },
    );
    app.post<{ Body: { streamId?: string } }>(
      '/dev/credits',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            properties: { streamId: { type: 'string', minLength: 1, maxLength: 100 } },
          },
        },
      },
      (request) => {
        hub.rollCredits(request.body.streamId ?? hub.snapshot().streamId);
        return hub.snapshot();
      },
    );
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DashboardActionError)
      return reply.code(error.statusCode).send({ error: error.message });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status < 500 ? 'Invalid request' : 'Request failed' });
  });
  app.addHook('preClose', async () => {
    detachPrivacy();
    dashboard.close();
    rehearsal.close();
    for (const client of clients) client.end();
    await debug.close();
  });
  return { app, hub, scoring, dashboard, ledger, botFilter, debug };
}
