import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from './app.js';
import { createProviders } from './ai/providers.js';
import { Matcher } from './matcher/index.js';
import { Pipeline } from './pipeline.js';
import { Store } from './store/index.js';
import { DEMO_STREAM_ID, replayDemo } from './demo/recording.js';

export async function runDemo(
  options: {
    once?: boolean;
    port?: number;
    signal?: AbortSignal;
    log?: (line: string) => void;
  } = {},
) {
  const log = options.log ?? console.log;
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const store = new Store();
  store.startRetentionJob();
  const { app, hub, scoring, dashboard, debug, botFilter } = createApp({
    store,
    enableDev: true,
    mode: 'offline-demo',
  });
  // Do not read process.env here: even an environment with keys must stay offline.
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    debug,
    botFilter,
    transcriber: providers.transcriber,
    matcher: new Matcher(providers.judge, providers.embeddings, undefined, (event) =>
      debug.judge(event),
    ),
    onTranscript: (window) => dashboard.transcript(window),
    onChat: (message) => dashboard.chat(message),
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', abort);
    controller.abort();
    pipeline.close();
    await app.close();
    store.close();
  };
  const abort = () => {
    void close();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    const address = await app.listen({ host: '127.0.0.1', port: options.port ?? 3000 });
    const port = new URL(address).port;
    log(
      'Credits Roll — offline rehearsal (deterministic fakes; no credentials or external requests)',
    );
    log(`Overlay: http://localhost:${port}/overlay`);
    log(`Dashboard: http://localhost:${port}/dashboard`);
    log(`Preview: http://localhost:${port}/overlay/?preview=1`);
    log('Replaying synthetic English transcript + chat...');
    dashboard.setReplayRunning(true);
    const moments = await replayDemo({
      pipeline,
      signal,
      realtime: !options.once,
      onMoment: (moment) =>
        log(
          `MOMENT @${moment.viewer.login} | ${moment.kind} | ${moment.confidence.toFixed(2)} | ${moment.quote}`,
        ),
    });
    if (!options.once) await delay(6500, undefined, { signal });
    signal.throwIfAborted();
    hub.rollCredits(DEMO_STREAM_ID);
    dashboard.setReplayRunning(false);
    const state = hub.snapshot();
    log(`CREDITS ROLL — ${moments.length} moments, ${state.credits.length} credited viewers`);
    for (const entry of state.wheel)
      log(`WHEEL @${entry.viewer.login} | reputation ${entry.points} | weight ${entry.weight}`);
    log('Opt-out honored: @quietartist has no moments, reputation, credits or wheel entry.');
    log(
      options.once
        ? 'Offline smoke run complete.'
        : 'Credits are rolling. Server stays open; press Ctrl+C to stop.',
    );
    if (options.once) await close();
    return { app, hub, store, moments, close };
  } catch (error) {
    const cancelled = options.signal?.aborted;
    await close();
    if (!cancelled) throw error;
    return { app, hub, store, moments: [], close };
  } finally {
    if (closed) signal.removeEventListener('abort', abort);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const port = Number(
    process.argv.find((argument) => argument.startsWith('--port='))?.slice(7) ?? 3000,
  );
  void runDemo({ once: process.argv.includes('--once'), signal: controller.signal, port }).catch(
    () => {
      console.error('Demo failed; check the selected port. Use --port=3001 if port 3000 is busy.');
      process.exitCode = 1;
    },
  );
}
