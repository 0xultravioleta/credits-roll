import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Accounts, TokenStorage } from './types.js';

export class FileTokenStorage implements TokenStorage {
  readonly path: string;
  constructor(path: string, repositoryRoot: string) {
    this.path = resolve(path);
    const initial = relative(resolve(repositoryRoot), dirname(this.path));
    if (!(initial === '..' || initial.startsWith(`..${sep}`) || isAbsolute(initial)))
      throw new Error('Token file must be outside the repository');
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const parent = realpathSync(dirname(this.path));
    const location = relative(realpathSync(repositoryRoot), parent);
    if (!(location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)))
      throw new Error('Token file must be outside the repository');
    if (existsSync(this.path) && lstatSync(this.path).isSymbolicLink())
      throw new Error('Token file cannot be a symlink');
  }
  read(): Accounts {
    if (!existsSync(this.path)) return {};
    try {
      const accounts = JSON.parse(readFileSync(this.path, 'utf8')) as Accounts;
      if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) throw new Error();
      for (const [role, token] of Object.entries(accounts)) {
        if (
          !['streamer', 'bot'].includes(role) ||
          !token ||
          typeof token.accessToken !== 'string' ||
          typeof token.refreshToken !== 'string' ||
          typeof token.userId !== 'string' ||
          typeof token.login !== 'string' ||
          !Array.isArray(token.scopes) ||
          token.scopes.some((scope: unknown) => typeof scope !== 'string') ||
          !Number.isFinite(token.expiresAt)
        )
          throw new Error();
      }
      chmodSync(this.path, 0o600);
      return accounts;
    } catch {
      throw new Error('Token file could not be read');
    }
  }
  write(accounts: Accounts): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const descriptor = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(descriptor, JSON.stringify(accounts), 'utf8');
      } finally {
        closeSync(descriptor);
      }
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
      chmodSync(this.path, 0o600);
    } catch {
      throw new Error('Token file could not be saved');
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
