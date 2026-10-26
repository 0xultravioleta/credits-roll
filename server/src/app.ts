import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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
}) {
  const app = Fastify({ logger: false, bodyLimit: 32_768 });
  const scoring = new Scoring(options.store);
  const hub = new OverlayHub(options.store, scoring);
  const clients = new Set<ServerResponse>();
  const dashboard = options.dashboard ?? new DashboardState(options.store);
  const rehearsal = new DashboardRehearsal(hub, dashboard);
  app.addHook('onRequest', async (request, reply) => {
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
  });
  if (options.accounts) registerOAuth(app, options.accounts, options.onConnected);
  else
    app.get('/auth/login', (_request, reply) =>
      reply.code(503).send({ error: 'Configure the Twitch application to connect accounts' }),
    );
  const overlayRoot =
    options.overlayRoot ?? fileURLToPath(new URL('../../overlay/dist/', import.meta.url));
  if (existsSync(overlayRoot)) {
    app.register(fastifyStatic, {
      root: overlayRoot,
      prefix: '/overlay/',
      index: ['index.html'],
      redirect: true,
    });
  }
  app.get('/overlay', (_request, reply) => reply.redirect('/overlay/'));
  app.get('/', (_request, reply) =>
    reply
      .type('text/html')
      .send(readFileSync(new URL('../../server/public/index.html', import.meta.url), 'utf8')),
  );
  app.get('/health', () => ({ status: 'ok', mode: options.mode ?? 'local' }));
  app.get('/api/state', () => hub.snapshot());
  app.get('/wheel', () => ({ entries: scoring.wheelEntries() }));

  app.get('/events', (request, reply) => {
    if (clients.size >= 20)
      return reply.code(503).send({ error: 'Overlay connection limit reached' });
    reply.hijack();
    const response = reply.raw;
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

  if (options.enableDev) {
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
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status < 500 ? 'Invalid request' : 'Request failed' });
  });
  app.addHook('preClose', async () => {
    dashboard.close();
    rehearsal.close();
    for (const client of clients) client.end();
  });
  return { app, hub, scoring, dashboard };
}
