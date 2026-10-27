import { posix } from 'node:path';

export interface HostedConfig {
  origin: string;
  host: string;
  allowedUserId: string;
  sessionSecret: string;
  overlayToken: string;
}

/** Missing PUBLIC_BASE_URL preserves the local configuration, including its paths. */
export function hostedConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig | undefined {
  if (!env.PUBLIC_BASE_URL) return undefined;
  const url = new URL(env.PUBLIC_BASE_URL);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('PUBLIC_BASE_URL must be an HTTPS origin without a path');
  if (!/^\d+$/.test(env.CR_ALLOWED_TWITCH_USER_ID ?? ''))
    throw new Error('Set CR_ALLOWED_TWITCH_USER_ID to the streamer Twitch user ID');
  for (const name of ['CR_SESSION_SECRET', 'CR_OVERLAY_TOKEN'] as const)
    if (!env[name] || Buffer.byteLength(env[name]) < 32)
      throw new Error(`Set ${name} to at least 32 random bytes`);
  if (env.CR_SESSION_SECRET === env.CR_OVERLAY_TOKEN)
    throw new Error('Session and overlay secrets must be different');
  return {
    origin: url.origin,
    host: url.host,
    allowedUserId: env.CR_ALLOWED_TWITCH_USER_ID!,
    sessionSecret: env.CR_SESSION_SECRET!,
    overlayToken: env.CR_OVERLAY_TOKEN!,
  };
}

export const HOSTED_PATHS = {
  DATABASE_PATH: '/data/credits-roll.sqlite',
  CREDITS_LEDGER_PATH: '/data/credits-ledger.jsonl',
  CR_DEBUG_LOG_PATH: '/data/debug-log.jsonl',
  CR_SUPERVISOR_ALERT_PATH: '/data/supervisor-alert.json',
  TWITCH_TOKEN_PATH: '/data/tokens.json',
} as const;

export function hostingEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const hosting = hostedConfig(env);
  if (!hosting) return env;
  const paths = Object.fromEntries(
    Object.entries(HOSTED_PATHS).map(([name, fallback]) => {
      const value = env[name] || fallback;
      if (
        !value.startsWith('/data/') ||
        value.includes('\\') ||
        value.split('/').includes('..') ||
        posix.normalize(value) === '/data'
      )
        throw new Error(`${name} must be an absolute file path under /data`);
      return [name, posix.normalize(value)];
    }),
  );
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length)
    throw new Error('Hosted private files need separate paths');
  return {
    ...env,
    ...paths,
    HOST: '0.0.0.0',
    TWITCH_REDIRECT_URI: `${hosting.origin}/auth/callback`,
  };
}
