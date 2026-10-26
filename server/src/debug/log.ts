import { appendFile, chmod, rename, unlink, writeFile } from 'node:fs/promises';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, TranscriptWindow } from '../domain.js';

export const DEBUG_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DEBUG_MAX_BYTES = 20 * 1024 * 1024;
export const DEBUG_PURGE_MS = 60 * 60 * 1000;
export type ChatDecision =
  'ignored-bot' | 'command' | 'too-long' | 'duplicate' | 'not-in-window' | 'candidate';
export interface DebugEvent {
  type: 'chat' | 'transcript' | 'judge';
  time: string;
  viewerId?: string;
  login?: string;
  messageId?: string;
  windowId?: string;
  streamId?: string;
  text?: string;
  decision?: ChatDecision;
  reason?: string;
  sentAt?: number;
  startAt?: number;
  endAt?: number;
  kind?: string | null;
  confidence?: number | null;
  rawConfidence?: number;
  kept?: boolean;
  threshold?: number;
  ordering?: string;
  deltaMs?: number;
}
export type JudgeAudit = Omit<DebugEvent, 'type' | 'time'> & {
  messageId: string;
  kept: boolean;
  reason: string;
  threshold: number;
};
const clipped = (text: string, limit: number) =>
  Array.from(
    text.replace(/(?:oauth:|Bearer\s+)[a-zA-Z0-9._-]+|\bsk-[a-zA-Z0-9_-]+/gi, '[redacted]'),
  )
    .slice(0, limit)
    .join('');

export class DebugLog {
  protected rows: { event: DebugEvent; line: string; bytes: number }[] = [];
  protected bytes = 0;
  protected rewrite = false;
  protected enabled: () => boolean = () => true;
  protected readonly blocked = new Set<string>();
  protected error: string | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  dropped = 0;
  constructor(
    protected readonly now: () => number = Date.now,
    protected readonly maxBytes = DEBUG_MAX_BYTES,
  ) {
    this.timer = setInterval(() => this.purge(DEBUG_PURGE_MS), DEBUG_PURGE_MS);
    this.timer.unref();
  }
  configure(enabled: () => boolean): void {
    this.enabled = enabled;
  }
  chat(message: ChatMessage, decision: ChatDecision, reason = decision): void {
    if (this.blocked.has(message.viewer.id)) return;
    this.record({
      type: 'chat',
      time: new Date(this.now()).toISOString(),
      viewerId: message.viewer.id,
      login: message.viewer.login,
      messageId: message.id,
      sentAt: message.sentAt,
      text: clipped(message.text, 200),
      decision,
      reason,
    });
  }
  transcript(window: TranscriptWindow): void {
    this.record({
      type: 'transcript',
      time: new Date(this.now()).toISOString(),
      windowId: window.id,
      streamId: window.streamId,
      startAt: window.startAt,
      endAt: window.endAt,
      text: clipped(window.text, 300),
    });
  }
  judge(event: JudgeAudit): void {
    if (event.viewerId && this.blocked.has(event.viewerId)) return;
    this.record({ ...event, type: 'judge', time: new Date(this.now()).toISOString() });
  }
  protected record(event: DebugEvent): void {
    if (!this.enabled()) return;
    const line = JSON.stringify(event) + '\n';
    const bytes = Buffer.byteLength(line);
    if (bytes > this.maxBytes) {
      this.dropped++;
      return;
    }
    this.rows.push({ event, line, bytes });
    this.bytes += bytes;
    const target = this.bytes > this.maxBytes ? Math.floor(this.maxBytes * 0.9) : this.maxBytes;
    while (this.bytes > target) {
      this.bytes -= this.rows.shift()!.bytes;
      this.dropped++;
      this.rewrite = true;
    }
    this.changed(line);
  }
  protected changed(_line?: string): void {
    void _line;
  }
  purge(headroomMs = 0): void {
    const cutoff = this.now() - DEBUG_RETENTION_MS + headroomMs;
    const retained = this.rows.filter(({ event }) => Date.parse(event.time) > cutoff);
    if (retained.length !== this.rows.length) {
      this.rows = retained;
      this.bytes = retained.reduce((sum, row) => sum + row.bytes, 0);
      this.rewrite = true;
      this.changed();
    }
  }
  forgetViewer(id: string): void {
    this.blocked.add(id);
    // Speech may quote or name a viewer, so erase all transcript snippets too.
    this.rows = this.rows.filter(
      ({ event }) => event.viewerId !== id && event.type !== 'transcript',
    );
    this.bytes = this.rows.reduce((sum, row) => sum + row.bytes, 0);
    this.rewrite = true;
    this.changed();
  }
  clear(): void {
    this.rows = [];
    this.bytes = 0;
    this.rewrite = true;
    this.changed();
  }
  viewerIds(): string[] {
    return [...new Set(this.rows.flatMap(({ event }) => (event.viewerId ? [event.viewerId] : [])))];
  }
  snapshot(): string {
    this.purge();
    return this.rows.map((row) => row.line).join('');
  }
  status() {
    this.purge();
    const decisions: Record<string, number> = {};
    for (const { event } of this.rows)
      if (event.type === 'chat') decisions[event.decision!] = (decisions[event.decision!] ?? 0) + 1;
    return {
      enabled: this.enabled(),
      bytes: this.bytes,
      maxBytes: this.maxBytes,
      retentionHours: 24,
      decisions,
      dropped: this.dropped,
      error: this.error,
    };
  }
  async flush(): Promise<void> {}
  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}

export class FileDebugLog extends DebugLog {
  readonly path: string;
  private pending: string[] = [];
  private scheduled?: ReturnType<typeof setTimeout>;
  private operation: Promise<void> = Promise.resolve();
  constructor(path: string, repositoryRoot: string, now = Date.now, maxBytes = DEBUG_MAX_BYTES) {
    super(now, maxBytes);
    this.path = resolve(path);
    const outside = (root: string, target: string) => {
      const location = relative(root, target);
      return location.startsWith(`..${sep}`) || location === '..' || isAbsolute(location);
    };
    if (!outside(resolve(repositoryRoot), this.path))
      throw new Error('Debug log must be outside the repository.');
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    if (
      !outside(realpathSync(repositoryRoot), realpathSync(dirname(this.path))) ||
      (existsSync(this.path) && lstatSync(this.path).isSymbolicLink())
    )
      throw new Error('Debug log must be a regular file outside the repository.');
    if (existsSync(this.path)) {
      chmodSync(this.path, 0o600);
      const size = statSync(this.path).size;
      const start = Math.max(0, size - maxBytes);
      const buffer = Buffer.alloc(Math.min(size, maxBytes));
      const descriptor = openSync(this.path, 'r');
      try {
        readSync(descriptor, buffer, 0, buffer.length, start);
      } finally {
        closeSync(descriptor);
      }
      const lines = buffer.toString('utf8').split(/\r?\n/);
      if (start) lines.shift();
      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as DebugEvent;
          if (
            ['chat', 'transcript', 'judge'].includes(event.type) &&
            Date.parse(event.time) > now() - DEBUG_RETENTION_MS
          ) {
            // Only this app's bounded event format is accepted on restart.
            if (event.text) event.text = clipped(event.text, event.type === 'chat' ? 200 : 300);
            const normalized = JSON.stringify(event) + '\n';
            this.rows.push({ event, line: normalized, bytes: Buffer.byteLength(normalized) });
          }
        } catch {
          this.dropped++;
        }
      }
      this.bytes = this.rows.reduce((sum, row) => sum + row.bytes, 0);
      while (this.bytes > maxBytes) this.bytes -= this.rows.shift()!.bytes;
    }
    this.rewrite = true;
  }
  protected override changed(line?: string): void {
    if (this.rewrite) this.pending = [];
    else if (line) this.pending.push(line);
    if (!this.scheduled) {
      this.scheduled = setTimeout(() => {
        this.scheduled = undefined;
        void this.flush().catch(() => undefined);
      }, 100);
      this.scheduled.unref();
    }
  }
  override flush(): Promise<void> {
    if (this.scheduled) clearTimeout(this.scheduled);
    this.scheduled = undefined;
    const replace = this.rewrite;
    const content = replace ? this.rows.map((row) => row.line).join('') : this.pending.join('');
    this.pending = [];
    this.rewrite = false;
    if (!replace && !content) return this.operation;
    const operation = this.operation
      .catch(() => undefined)
      .then(async () => {
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          if (replace) {
            await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
            await chmod(temporary, 0o600);
            await rename(temporary, this.path);
          } else await appendFile(this.path, content, { mode: 0o600 });
          this.error = null;
        } catch {
          this.rewrite = true;
          this.error = 'Debug log could not be saved. Check local disk space and permissions.';
          throw new Error(this.error);
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      });
    this.operation = operation;
    return operation;
  }
}
