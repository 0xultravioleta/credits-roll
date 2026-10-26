import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { Store } from './store/index.js';
import { createProviders } from './ai/providers.js';
import { Matcher } from './matcher/index.js';
import { Pipeline } from './pipeline.js';
import { RecordedChatSource } from './twitch/recorded.js';
import { createOAuth } from './auth/config.js';
import { LiveRuntime } from './live/runtime.js';
import { OpenAIClient, OpenAITranscriber } from './ai/openai.js';

export const APP_NAME = 'Credits Roll';
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function start(): Promise<void> {
  const providers = createProviders();
  const accounts = createOAuth(PROJECT_ROOT);
  const live = process.env.CHAT_SOURCE === 'live';
  const source =
    !live && process.env.RECORDED_CHAT_PATH
      ? new RecordedChatSource(resolve(PROJECT_ROOT, process.env.RECORDED_CHAT_PATH), {
          speed: 1,
        })
      : undefined;
  const store = new Store(
    resolve(PROJECT_ROOT, process.env.DATABASE_PATH ?? 'data/credits-roll.sqlite'),
  );
  store.startRetentionJob();
  const { app, hub, scoring, dashboard } = createApp({
    store,
    accounts,
    enableDev: process.env.ENABLE_DEV_ENDPOINTS === 'true',
    mode: live ? 'live-chat' : 'local',
    onTranscript: (window) => pipeline.processWindow(window),
    actions: {
      start: () => runtime.actions.start!(),
      stop: () => runtime.actions.stop!(),
      disconnect: () => runtime.actions.disconnect!(),
      settingsChanged: (settings) => runtime.actions.settingsChanged!(settings),
      rollCredits: () => runtime.actions.rollCredits!(),
      spinWheel: () => runtime.actions.spinWheel!(),
    },
  });
  const pipeline: Pipeline = new Pipeline({
    store,
    hub,
    scoring,
    transcriber: providers.transcriber,
    matcher: new Matcher(
      providers.judge,
      providers.embeddings,
      () => dashboard.getSettings().confidenceThreshold,
    ),
    onTranscript: (window) => dashboard.transcript(window),
    onPrivacy: (viewerId, _command, messageId) => runtime.privacy(viewerId, messageId),
  });
  const controller = new AbortController();
  const transcriber = process.env.OPENAI_API_KEY
    ? new OpenAITranscriber(
        new OpenAIClient(process.env.OPENAI_API_KEY),
        process.env.OPENAI_TRANSCRIPTION_MODEL,
      )
    : providers.transcriber;
  const audioDelay = Number(process.env.AUDIO_DELAY_MS ?? 0);
  if (!Number.isFinite(audioDelay) || audioDelay < 0 || audioDelay > 60_000)
    throw new Error('Invalid audio delay');
  const runtime: LiveRuntime = new LiveRuntime({
    enabled: live,
    accounts,
    dashboard,
    hub,
    pipeline,
    store,
    transcriber,
    apiKeyPresent: !!process.env.OPENAI_API_KEY,
    audioDelay,
  });
  if (accounts)
    await accounts
      .validateAll()
      .catch(() => console.error('Twitch authorization requires reconnection.'));
  const validationTimer = accounts
    ? setInterval(
        () => {
          void accounts
            .validateAll()
            .catch(() => console.error('Twitch authorization requires reconnection.'));
        },
        60 * 60 * 1000,
      )
    : undefined;
  validationTimer?.unref();
  try {
    await app.listen({
      host: process.env.HOST ?? '127.0.0.1',
      port: Number(process.env.PORT ?? 3000),
    });
  } catch {
    if (validationTimer) clearInterval(validationTimer);
    await runtime.stop().catch(() => undefined);
    await app.close();
    pipeline.close();
    store.close();
    throw new Error('Server startup failed');
  }
  console.log(`${APP_NAME} listening at http://localhost:${process.env.PORT ?? 3000}`);
  if (source)
    void source
      .run((message) => pipeline.addChat(message), controller.signal)
      .catch(() => {
        if (!controller.signal.aborted)
          console.error('Chat source stopped; check authorization or recorded input.');
      });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    if (validationTimer) clearInterval(validationTimer);
    try {
      await runtime.stop();
    } catch {
      console.error('Local inputs stopped. Review pending Channel Points rewards in Twitch.');
    } finally {
      pipeline.close();
      await app.close();
      store.close();
    }
  };
  process.once('SIGINT', () => {
    void stop();
  });
  process.once('SIGTERM', () => {
    void stop();
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void start().catch(() => {
    console.error('Credits Roll could not start; check configuration and port availability.');
    process.exitCode = 1;
  });
}
