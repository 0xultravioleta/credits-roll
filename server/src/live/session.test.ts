import { afterEach, expect, test, vi } from 'vitest';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { Pipeline } from '../pipeline.js';
import { Matcher } from '../matcher/index.js';
import { createProviders } from '../ai/providers.js';
import { OAuthAccounts } from '../auth/oauth.js';
import { SCOPES } from '../auth/types.js';
import { ListeningSession } from './session.js';
import type { TranscriptSource } from '../transcript/source.js';
import type { Accounts, AccountRole } from '../auth/types.js';
import { LiveTranscriptSource } from '../transcript/live.js';
import type { ChatHandler } from '../twitch/source.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  let saved: Accounts = {};
  let role: AccountRole = 'streamer';
  const accounts = new OAuthAccounts(
    {
      clientId: 'client',
      clientSecret: 'synthetic',
      redirectUri: 'http://localhost/auth/callback',
    },
    {
      read: () => saved,
      write: (value) => {
        saved = value;
      },
    },
    {
      exchange: async () => ({
        accessToken: 'synthetic',
        refreshToken: 'synthetic-refresh',
        expiresIn: 3600,
        scopes: [...SCOPES[role]],
      }),
      refresh: async () => {
        throw new Error('Not needed');
      },
      validate: async () => ({
        clientId: 'client',
        userId: role,
        login: role,
        expiresIn: 3600,
        scopes: [...SCOPES[role]],
      }),
    },
  );
  await accounts.authorize(role, 'code');
  role = 'bot';
  await accounts.authorize(role, 'code');
  const store = new Store();
  const { app, hub, scoring, dashboard } = createApp({ store });
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    matcher: new Matcher(providers.judge, providers.embeddings),
    transcriber: providers.transcriber,
    onTranscript: (window) => dashboard.transcript(window),
  });
  const chat = vi.fn(() => ({
    run: async (_handler: unknown, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  }));
  const transcript = vi.fn((): TranscriptSource => ({
    run: async (_handler: unknown, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return 'aborted' as const;
    },
  }));
  const pause = vi.fn(async () => undefined);
  const session = new ListeningSession({
    enabled: true,
    accounts,
    dashboard,
    hub,
    pipeline,
    chat,
    transcript,
    stream: async () => 'stream',
    onStop: pause,
  });
  cleanup.push(async () => {
    await session.stop();
    pipeline.close();
    await app.close();
    store.close();
  });
  return { session, chat, transcript, accounts, pause, dashboard, pipeline, providers, hub };
}

test.each(['transcription', 'embeddings', 'judge'] as const)(
  'one %s failure skips a chunk, keeps the session and chat, and credits the next adoption',
  async (stage) => {
    const { session, chat, transcript, pipeline, providers, hub } = await setup();
    const now = Date.now() - 5000;
    const methods = {
      transcription: [providers.transcriber, 'transcribe'],
      embeddings: [providers.embeddings, 'embed'],
      judge: [providers.judge, 'judge'],
    } as const;
    // Fail at the actual injected provider boundary, not by replacing the whole pipeline.
    if (stage === 'transcription')
      vi.spyOn(methods.transcription[0], 'transcribe').mockRejectedValueOnce(
        new Error('private response'),
      );
    if (stage === 'embeddings')
      vi.spyOn(methods.embeddings[0], 'embed').mockRejectedValueOnce(new Error('private response'));
    if (stage === 'judge')
      vi.spyOn(methods.judge[0], 'judge').mockRejectedValueOnce(new Error('private response'));
    const clear = vi.spyOn(pipeline, 'clearChat');
    chat.mockImplementation(() => ({
      run: async (handler: unknown, signal: AbortSignal) => {
        await (handler as ChatHandler)({
          id: 'suggestion',
          viewer: { id: 'viewer', login: 'synthetic_viewer' },
          text: 'Prueba el puente del norte',
          sentAt: now - 2000,
        });
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
    }));
    const failed = vi.fn();
    transcript.mockImplementation(
      () =>
        new LiveTranscriptSource({
          channel: 'synthetic',
          streamId: 'stream',
          apiKeyPresent: true,
          language: () => 'es',
          transcriber: providers.transcriber,
          onProviderFailure: failed,
          runner: {
            available: async () => true,
            chunks: async function* (_channel, signal) {
              for (let index = 0; index < 2; index++)
                yield {
                  startAt: now,
                  endAt: now + 1000 + index,
                  chunk: {
                    bytes: new TextEncoder().encode('Buena idea, pruebo el puente del norte.'),
                    filename: 'fake.txt',
                    mimeType: 'text/plain',
                  },
                };
              await new Promise<void>((resolve) =>
                signal.addEventListener('abort', () => resolve(), { once: true }),
              );
            },
          },
        }),
    );
    await session.start();
    await vi.waitFor(() => expect(hub.snapshot().credits).toHaveLength(1));
    expect(session.running).toBe(true);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ stage }), 1);
    expect(clear).toHaveBeenCalledTimes(1); // Session start only; no provider-error reset.
    expect(hub.snapshot().credits[0]?.viewer.login).toBe('synthetic_viewer');
  },
);

test('concurrent Start actions share one capture and Stop aborts it', async () => {
  const { session, chat, transcript, pause } = await setup();
  await Promise.all([session.start(), session.start()]);
  expect(chat).toHaveBeenCalledOnce();
  expect(transcript).toHaveBeenCalledOnce();
  await session.stop();
  expect(session.running).toBe(false);
  expect(pause).toHaveBeenCalledOnce();
});

test('Stop while authorization is pending prevents capture launch', async () => {
  const { session, chat, accounts } = await setup();
  let release!: (token: string) => void;
  const waiting = new Promise<string>((resolve) => {
    release = resolve;
  });
  vi.spyOn(accounts, 'accessToken').mockReturnValue(waiting);
  const starting = session.start();
  await Promise.resolve();
  await Promise.resolve();
  const stopping = session.stop();
  release('synthetic');
  await starting;
  await stopping;
  expect(chat).not.toHaveBeenCalled();
  expect(session.running).toBe(false);
});

test('already listening returns an actionable error and Stop permits a fresh session', async () => {
  const { session, chat } = await setup();
  await session.start();
  await expect(session.start()).rejects.toThrow('Already listening');
  expect(session.running).toBe(true);
  await session.stop();
  await session.start();
  expect(chat).toHaveBeenCalledTimes(2);
});

test('skipped audio releases the stale listening session and explains missing tools', async () => {
  const { session, transcript, dashboard, pause } = await setup();
  transcript.mockReturnValueOnce({ run: async () => 'skipped' });
  await session.start();
  await vi.waitFor(() => expect(pause).toHaveBeenCalledOnce());
  expect(session.running).toBe(false);
  await vi.waitFor(() => expect(dashboard.getStatus()).toContain('Audio capture was skipped'));
  expect(dashboard.getStatus()).toContain('Practice is available');
  await session.start();
  expect(session.running).toBe(true);
});

test('authorization failures reach the button as safe instructions, without provider secrets', async () => {
  const { session, accounts, dashboard } = await setup();
  vi.spyOn(accounts, 'accessToken').mockRejectedValue(new Error('private-provider-response'));
  await expect(session.start()).rejects.toThrow('Check Twitch authorization');
  expect(session.running).toBe(false);
  expect(dashboard.getStatus()).not.toContain('private-provider-response');
});
