import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

export interface SupervisorAlert {
  id: string;
  time: string;
  reason: 'restart-limit';
  restarts: 5;
  windowMinutes: 10;
}
export class SupervisorAlerts {
  protected alert: SupervisorAlert | null = null;
  read(): SupervisorAlert | null {
    return this.alert ? { ...this.alert } : null;
  }
  exhausted(): void {
    this.save({
      id: randomUUID(),
      time: new Date().toISOString(),
      reason: 'restart-limit',
      restarts: 5,
      windowMinutes: 10,
    });
  }
  clear(): void {
    this.save(null);
  }
  protected save(alert: SupervisorAlert | null): void {
    this.alert = alert;
  }
}
export class FileSupervisorAlerts extends SupervisorAlerts {
  readonly path: string;
  constructor(path: string, root: string) {
    super();
    this.path = resolve(path);
    const outside = (location: string) => {
      const part = relative(realpathSync(root), location);
      return part === '..' || part.startsWith('..' + sep) || isAbsolute(part);
    };
    if (!outside(dirname(this.path)))
      throw new Error('Supervisor status must be outside the repository');
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    if (
      !outside(realpathSync(dirname(this.path))) ||
      (existsSync(this.path) && lstatSync(this.path).isSymbolicLink())
    )
      throw new Error('Supervisor status requires a private regular file');
    if (existsSync(this.path)) {
      chmodSync(this.path, 0o600);
      const row = JSON.parse(readFileSync(this.path, 'utf8')) as SupervisorAlert | null;
      if (
        row &&
        (row.reason !== 'restart-limit' ||
          row.restarts !== 5 ||
          row.windowMinutes !== 10 ||
          typeof row.id !== 'string' ||
          !Number.isFinite(Date.parse(row.time)))
      )
        throw new Error('Invalid supervisor status file');
      this.alert = row;
    }
  }
  protected override save(alert: SupervisorAlert | null): void {
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(alert) + '\n', 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
      this.alert = alert;
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
export function supervisorAlertPath(env: NodeJS.ProcessEnv = process.env): string {
  const ledger = resolve(
    env.CREDITS_LEDGER_PATH || join(homedir(), '.credits-roll', 'credits-ledger.jsonl'),
  );
  const path = resolve(
    env.CR_SUPERVISOR_ALERT_PATH || join(dirname(ledger), 'supervisor-alert.json'),
  );
  const protectedPaths = [
    ledger,
    resolve(env.CR_DEBUG_LOG_PATH || join(dirname(ledger), 'debug-log.jsonl')),
    resolve(env.TWITCH_TOKEN_PATH || join(homedir(), '.credits-roll', 'tokens.json')),
  ];
  if (
    protectedPaths.some((file) =>
      process.platform === 'win32' ? file.toLowerCase() === path.toLowerCase() : file === path,
    )
  )
    throw new Error('Supervisor status needs its own file');
  return path;
}
