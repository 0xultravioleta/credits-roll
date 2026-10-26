import type { ChatMessage, Viewer } from '../domain.js';
import { validLogin } from './source.js';

export const DEFAULT_IGNORED_LOGINS = [
  'nightbot',
  'streamelements',
  'streamlabs',
  'moobot',
  'fossabot',
  'wizebot',
  'sery_bot',
  'soundalerts',
  'commanderroot',
] as const;

export function parseIgnoredLogins(input: string | readonly string[]): string[] {
  const values = typeof input === 'string' ? input.split(',') : input;
  const normalized = values
    .map((value) => value.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  if (normalized.length > 200 || normalized.some((value) => !validLogin(value)))
    throw new Error('Use at most 200 Twitch logins, separated by commas.');
  return [...new Set(normalized)];
}

export class BotFilter {
  private readonly knownIds = new Set<string>();
  constructor(
    private readonly logins: () => readonly string[] = () => DEFAULT_IGNORED_LOGINS,
    private readonly accounts: () => readonly Viewer[] = () => [],
  ) {}
  ignoredLogins(): string[] {
    return parseIgnoredLogins([
      ...this.logins(),
      ...this.accounts().map((account) => account.login),
    ]);
  }
  ignores(message: ChatMessage): boolean {
    const ignored =
      message.botLike === true ||
      this.knownIds.has(message.viewer.id) ||
      this.accounts().some((account) => account.id === message.viewer.id) ||
      this.ignoredLogins().includes(message.viewer.login.toLowerCase());
    if (ignored) {
      // IDs survive a bot rename within this process, without storing identities on disk.
      if (this.knownIds.size < 1000) this.knownIds.add(message.viewer.id);
    }
    return ignored;
  }
}
