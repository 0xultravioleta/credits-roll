import { mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { FileCreditLedger, LEDGER_WARNING_BYTES, creditRecord } from './index.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'credits-ledger-test-'));
  directories.push(directory);
  const path = join(directory, 'credits-ledger.jsonl');
  return { path, ledger: new FileCreditLedger(path, process.cwd()) };
}
const record = (id = 'one') =>
  creditRecord(
    {
      id,
      messageId: id,
      streamId: 'synthetic-stream',
      viewer: { id: 'synthetic-viewer', login: 'syntheticviewer' },
      kind: 'idea',
      confidence: 0.95,
      quote: '🌉'.repeat(160),
      adoptionExcerpt: 'A'.repeat(250),
      occurredAt: Date.parse('2026-10-26T12:00:00Z'),
    },
    10,
    { channelId: 'synthetic-channel', judgeModel: 'fake' },
  );

test('atomic appends preserve prior bytes and load once per credit across ledger recreation', () => {
  const { path, ledger } = setup();
  ledger.append(record());
  const first = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  ledger.append(record('two'));
  expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n').startsWith(first)).toBe(true);
  const reopened = new FileCreditLedger(path, process.cwd());
  reopened.append(record());
  expect(reopened.read()).toHaveLength(2);
  expect(reopened.read()[0]).toMatchObject({
    schema: 1,
    time: '2026-10-26T12:00:00.000Z',
    channelId: 'synthetic-channel',
    judgeModel: 'fake',
  });
  expect(Array.from(reopened.read()[0]!.quote)).toHaveLength(140);
  expect(Array.from(reopened.read()[0]!.adoptionExcerpt)).toHaveLength(200);
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
});
test('corrupt ledgers fail closed without overwriting the file', () => {
  const { path } = setup();
  writeFileSync(path, 'not JSON\n');
  expect(() => new FileCreditLedger(path, process.cwd())).toThrow('No records were overwritten');
  expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).toBe('not JSON\n');
});
test('rejects repository storage and warns at 50 MB without compacting', () => {
  expect(
    () => new FileCreditLedger(join(process.cwd(), 'credits-ledger.jsonl'), process.cwd()),
  ).toThrow('outside');
  const { path, ledger } = setup();
  expect(ledger.sizeWarning).toBeNull();
  truncateSync(path, LEDGER_WARNING_BYTES);
  expect(ledger.sizeWarning).toContain('50 MB');
  expect(statSync(path).size).toBe(LEDGER_WARNING_BYTES);
});
