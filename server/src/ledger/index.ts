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
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Moment, MomentKind } from '../domain.js';
import { MOMENT_KINDS } from '../domain.js';
import { shortExcerpt } from '../matcher/excerpt.js';
import type { CreditSink } from './sink.js';
export type { CreditSink } from './sink.js';

export const LEDGER_SCHEMA = 1;
export const LEDGER_WARNING_BYTES = 50 * 1024 * 1024;
export const quoteText = (text: string) => Array.from(text.trim()).slice(0, 140).join('');
export interface CreditRecord {
  schema: 1;
  id: string;
  time: string;
  streamId: string;
  channelId: string;
  viewerId: string;
  login: string;
  kind: MomentKind;
  confidence: number;
  points: number;
  quote: string;
  adoptionExcerpt: string;
  judgeModel: string;
  sourceMessageId: string;
}
export interface CreditContext {
  channelId: string;
  judgeModel: string;
}
export function creditRecord(moment: Moment, points: number, context: CreditContext): CreditRecord {
  return {
    schema: LEDGER_SCHEMA,
    id: moment.id,
    time: new Date(moment.occurredAt).toISOString(),
    streamId: moment.streamId,
    channelId: context.channelId,
    viewerId: moment.viewer.id,
    login: moment.viewer.login,
    kind: moment.kind,
    confidence: moment.confidence,
    points,
    quote: quoteText(moment.quote),
    adoptionExcerpt: shortExcerpt(moment.adoptionExcerpt ?? ''),
    judgeModel: context.judgeModel,
    sourceMessageId: moment.messageId,
  };
}
function validate(value: unknown): CreditRecord {
  const row = value as CreditRecord;
  if (
    !row ||
    row.schema !== LEDGER_SCHEMA ||
    !MOMENT_KINDS.includes(row.kind) ||
    !['id', 'streamId', 'channelId', 'viewerId', 'login', 'judgeModel', 'sourceMessageId'].every(
      (key) =>
        typeof row[key as keyof CreditRecord] === 'string' &&
        String(row[key as keyof CreditRecord]).length > 0,
    ) ||
    !Number.isFinite(Date.parse(row.time)) ||
    new Date(row.time).toISOString() !== row.time ||
    !Number.isFinite(row.confidence) ||
    row.confidence < 0 ||
    row.confidence > 1 ||
    !Number.isSafeInteger(row.points) ||
    row.points < 0 ||
    typeof row.quote !== 'string' ||
    !row.quote.trim() ||
    Array.from(row.quote).length > 140 ||
    typeof row.adoptionExcerpt !== 'string' ||
    Array.from(row.adoptionExcerpt).length > 200
  )
    throw new Error('Credit ledger contains an invalid record; repair a copy before restarting.');
  return {
    schema: 1,
    id: row.id,
    time: row.time,
    streamId: row.streamId,
    channelId: row.channelId,
    viewerId: row.viewerId,
    login: row.login,
    kind: row.kind,
    confidence: row.confidence,
    points: row.points,
    quote: row.quote,
    adoptionExcerpt: row.adoptionExcerpt,
    judgeModel: row.judgeModel,
    sourceMessageId: row.sourceMessageId,
  };
}
export class MemoryCreditLedger implements CreditSink {
  protected records: CreditRecord[] = [];
  protected revision = 0;
  get version(): number {
    return this.revision;
  }
  read(): CreditRecord[] {
    return this.records.map((row) => ({ ...row }));
  }
  onCredit(record: CreditRecord): void {
    this.append(record);
  }
  hasCredit(
    record: Pick<CreditRecord, 'id' | 'channelId' | 'streamId' | 'sourceMessageId'>,
  ): boolean {
    return this.records.some(
      (item) =>
        item.id === record.id ||
        (item.channelId === record.channelId &&
          item.streamId === record.streamId &&
          item.sourceMessageId === record.sourceMessageId),
    );
  }
  append(record: CreditRecord): void {
    const row = validate(record);
    if (this.hasCredit(row)) return;
    this.persist([...this.records, row], row);
  }
  forgetViewer(viewerId: string): void {
    const retained = this.records.filter((row) => row.viewerId !== viewerId);
    if (retained.length !== this.records.length) this.persist(retained);
  }
  protected persist(records: CreditRecord[], appended?: CreditRecord): void {
    void appended;
    this.records = records;
    this.revision++;
  }
  get sizeWarning(): string | null {
    return null;
  }
}

export class FileCreditLedger extends MemoryCreditLedger {
  readonly path: string;
  constructor(path: string, repositoryRoot: string) {
    super();
    this.path = resolve(path);
    const outside = (parent: string) => {
      const location = relative(realpathSync(repositoryRoot), parent);
      return location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location);
    };
    const initial = relative(resolve(repositoryRoot), this.path);
    if (!(initial.startsWith(`..${sep}`) || isAbsolute(initial)))
      throw new Error('Credit ledger must be outside the repository.');
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    if (
      !outside(realpathSync(dirname(this.path))) ||
      (existsSync(this.path) && lstatSync(this.path).isSymbolicLink())
    )
      throw new Error('Credit ledger must be a regular file outside the repository.');
    if (existsSync(this.path)) {
      chmodSync(this.path, 0o600);
      try {
        this.records = readFileSync(this.path, 'utf8')
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => validate(JSON.parse(line)));
      } catch {
        throw new Error('Credit ledger could not be loaded. No records were overwritten.');
      }
    } else this.persist([]);
  }
  protected override persist(records: CreditRecord[], appended?: CreditRecord): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      // Preserve prior bytes; atomic replacement exposes either the old file or its complete append.
      const previous = appended && existsSync(this.path) ? readFileSync(this.path, 'utf8') : '';
      const content = appended
        ? previous +
          (previous && !previous.endsWith('\n') ? '\n' : '') +
          JSON.stringify(appended) +
          '\n'
        : records.map((row) => JSON.stringify(row) + '\n').join('');
      const descriptor = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(descriptor, content, 'utf8');
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
      this.records = records;
      this.revision++;
    } catch {
      throw new Error('Credit ledger could not be saved. Check disk space and file permissions.');
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  override get sizeWarning(): string | null {
    return statSync(this.path).size >= LEDGER_WARNING_BYTES
      ? 'The local credit ledger is at least 50 MB. No records are rotated or compacted automatically.'
      : null;
  }
}
export function createCreditLedger(
  repositoryRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): FileCreditLedger {
  return new FileCreditLedger(
    env.CREDITS_LEDGER_PATH || join(homedir(), '.credits-roll', 'credits-ledger.jsonl'),
    repositoryRoot,
  );
}
