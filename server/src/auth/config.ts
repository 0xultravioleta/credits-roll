import { homedir } from 'node:os';
import { join } from 'node:path';
import { FileTokenStorage } from './storage.js';
import { OAuthAccounts, TwitchOAuthTransport } from './oauth.js';
import { hostedConfig } from '../hosting/config.js';

export function createOAuth(
  repositoryRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): OAuthAccounts | undefined {
  const hosting = hostedConfig(env);
  if (!env.TWITCH_CLIENT_ID && !env.TWITCH_CLIENT_SECRET) return undefined;
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET)
    throw new Error('Set Twitch client ID and client secret together');
  const redirectUri = hosting
    ? `${hosting.origin}/auth/callback`
    : (env.TWITCH_REDIRECT_URI ?? 'http://localhost:3000/auth/callback');
  const url = new URL(redirectUri);
  if (
    (!hosting && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/auth/callback' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Use a loopback OAuth callback URL');
  const config = {
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
    redirectUri,
  };
  return new OAuthAccounts(
    config,
    new FileTokenStorage(
      env.TWITCH_TOKEN_PATH ||
        (hosting ? '/data/tokens.json' : join(homedir(), '.credits-roll', 'tokens.json')),
      repositoryRoot,
    ),
    new TwitchOAuthTransport(config),
    Date.now,
    hosting?.allowedUserId,
  );
}
