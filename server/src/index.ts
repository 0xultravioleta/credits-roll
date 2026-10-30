import { resolve, dirname, join } from 'node:path';
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
import { ProcessAudioRunner } from './transcript/runner.js';
import { createCreditLedger } from './ledger/index.js';
import { parseIgnoredLogins } from './twitch/bot-filter.js';
import { FileDebugLog } from './debug/log.js';
import { startWatchdog } from './runtime/watchdog.js';
import { FileSupervisorAlerts, supervisorAlertPath } from './runtime/supervisor-alert.js';
import { hostedConfig, hostingEnvironment, HOSTED_PATHS } from './hosting/config.js';
import { shutdownHosted } from './hosting/shutdown.js';
import { prepareHostedFiles } from './hosting/files.js';
import { LiveCounters } from './live/counters.js';

export const APP_NAME = 'Credits Roll';
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function start(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ stop: () => Promise<void> }> {
  const env = hostingEnvironment(environment);
  const hosting = hostedConfig(env);
  if (hosting) {
    process.umask(0o077);
    prepareHostedFiles(Object.keys(HOSTED_PATHS).map((name) => env[name]!));
  }
  const providers = createProviders(env);
  const accounts = createOAuth(PROJECT_ROOT, env);
  const live = env.CHAT_SOURCE === 'live';
  const audioRunner = new ProcessAudioRunner();
  const tools = live
    ? {
        streamlink: await audioRunner.available('streamlink'),
        ffmpeg: await audioRunner.available('ffmpeg'),
      }
    : { streamlink: null, ffmpeg: null };
  const source =
    !live && env.RECORDED_CHAT_PATH
      ? new RecordedChatSource(resolve(PROJECT_ROOT, env.RECORDED_CHAT_PATH), {
          speed: 1,
        })
      : undefined;
  const store = new Store(resolve(PROJECT_ROOT, env.DATABASE_PATH ?? 'data/credits-roll.sqlite'));
  store.startRetentionJob();
  const ledger = createCreditLedger(PROJECT_ROOT, env);
  const debug = new FileDebugLog(
    env.CR_DEBUG_LOG_PATH || join(dirname(ledger.path), 'debug-log.jsonl'),
    PROJECT_ROOT,
  );
  if (debug.path === ledger.path)
    throw new Error('Debug log and credit ledger need separate paths');
  const counters = new LiveCounters(
    () => runtime.transcriptionStatus().resolved,
    () => dashboard.getSettings().confidenceThreshold,
  );
  const { app, hub, scoring, dashboard, botFilter } = createApp({
    store,
    hosting,
    accounts,
    ignoredLogins: parseIgnoredLogins(env.IGNORED_LOGINS ?? ''),
    ledger,
    debug,
    supervisorAlerts: new FileSupervisorAlerts(supervisorAlertPath(env), PROJECT_ROOT),
    creditContext: () => ({
      channelId: accounts?.identity('streamer')?.id ?? 'local',
      judgeModel: env.JUDGE === 'openai' ? (env.OPENAI_JUDGE_MODEL ?? 'gpt-4o-mini') : 'fake',
    }),
    enableDev: env.ENABLE_DEV_ENDPOINTS === 'true',
    mode: live ? 'live-chat' : 'local',
    onConnected: () => {
      void runtime
        .initialize()
        .catch(() =>
          dashboard.setStatus('Cannot connect stream notifications. Check Twitch authorization.'),
        );
    },
    environment: () => ({
      liveEnabled: live,
      apiKeyPresent: !!env.OPENAI_API_KEY,
      tools,
      listening: runtime.running,
      transcription: runtime.transcriptionStatus(),
      providers: runtime.providerStatus(),
      broadcasterType: runtime.broadcasterType,
      status: runtime.auto.snapshot(),
      clips: runtime.clipStatus(),
      get forecast() {
        return runtime.forecastStatus();
      },
      get forecastMoments() {
        return runtime.forecastMoments();
      },
      get entriesRefunded() {
        return runtime.entriesRefunded();
      },
    }),
    onTranscript: (window) => pipeline.processWindow(window),
    actions: {
      start: () => runtime.actions.start!(),
      stop: () => runtime.actions.stop!(),
      disconnect: (role) => runtime.actions.disconnect!(role),
      settingsChanged: (settings) => runtime.actions.settingsChanged!(settings),
      settingsSaved: () => runtime.actions.settingsSaved!(),
      rollCredits: () => runtime.actions.rollCredits!(),
      spinWheel: () => runtime.actions.spinWheel!(),
      startForecast: (minutes) => runtime.actions.startForecast!(minutes),
      cancelForecast: () => runtime.actions.cancelForecast!(),
      correctForecast: (id, excluded) => runtime.actions.correctForecast!(id, excluded),
    },
  });
  const pipeline: Pipeline = new Pipeline({
    counters,
    store,
    hub,
    scoring,
    botFilter,
    debug,
    transcriber: providers.transcriber,
    lookbackSeconds: () => dashboard.getSettings().lookbackSeconds,
    allowAfterReply: () => dashboard.getSettings().allowAfterReply,
    matcher: new Matcher(
      providers.judge,
      providers.embeddings,
      () => dashboard.getSettings().confidenceThreshold,
      (event) => debug.judge(event),
      () => dashboard.getSettings(),
      counters,
    ),
    onTranscript: (window) => dashboard.transcript(window),
    onChat: (message) => dashboard.chat(message),
    onCredit: (moment) => runtime.credit(moment),
    onPrivacy: (viewerId, _command, messageId) => runtime.privacy(viewerId, messageId),
  });
  const controller = new AbortController();
  await debug.flush();
  const transcriber = env.OPENAI_API_KEY
    ? new OpenAITranscriber(new OpenAIClient(env.OPENAI_API_KEY), env.OPENAI_TRANSCRIPTION_MODEL)
    : providers.transcriber;
  const audioDelay = Number(env.AUDIO_DELAY_MS ?? 0);
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
    apiKeyPresent: !!env.OPENAI_API_KEY,
    audioDelay,
    transcriptionLanguage: env.CR_TRANSCRIPTION_LANGUAGE,
    counters,
    tools,
    ledger,
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
      host: env.HOST ?? '127.0.0.1',
      port: Number(env.PORT ?? 3000),
    });
  } catch {
    if (validationTimer) clearInterval(validationTimer);
    await runtime.stop().catch(() => undefined);
    await app.close();
    pipeline.close();
    store.close();
    throw new Error('Server startup failed');
  }
  console.log(
    `${APP_NAME} listening at ${hosting?.origin ?? `http://localhost:${env.PORT ?? 3000}`}`,
  );
  counters.start();
  void runtime
    .initialize()
    .catch(() =>
      dashboard.setStatus('Cannot connect stream notifications. Check Twitch authorization.'),
    );
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Local health address unavailable');
  const stopWatchdog = hosting
    ? async () => undefined
    : startWatchdog(
        `http://${address.address.includes(':') ? '[::1]' : '127.0.0.1'}:${address.port}/health`,
      );
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
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    counters.close();
    controller.abort();
    if (validationTimer) clearInterval(validationTimer);
    if (hosting) {
      await shutdownHosted({
        stopInputs: () => runtime.stop(true),
        closePipeline: () => pipeline.close(),
        closeServer: () => app.close(),
        flush: () => debug.close(),
        closeStore: () => store.close(),
        log: (message) => console.error(message),
        exit: (code) => process.exit(code),
      });
      return;
    }
    await stopWatchdog();
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
  const onSignal = () => {
    void stop();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return { stop };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void start().catch(() => {
    console.error('Credits Roll could not start; check configuration and port availability.');
    process.exitCode = 1;
  });
}
