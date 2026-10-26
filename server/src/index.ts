import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { Store } from './store/index.js';

export const APP_NAME = 'Credits Roll';
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function start(): Promise<void> {
  const store = new Store(
    resolve(PROJECT_ROOT, process.env.DATABASE_PATH ?? 'data/credits-roll.sqlite'),
  );
  store.startRetentionJob();
  const { app } = createApp({ store, enableDev: process.env.ENABLE_DEV_ENDPOINTS === 'true' });
  try {
    await app.listen({
      host: process.env.HOST ?? '127.0.0.1',
      port: Number(process.env.PORT ?? 3000),
    });
  } catch {
    await app.close();
    store.close();
    throw new Error('Server startup failed');
  }
  console.log(`${APP_NAME} listening at http://localhost:${process.env.PORT ?? 3000}`);
  const stop = async () => {
    await app.close();
    store.close();
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
