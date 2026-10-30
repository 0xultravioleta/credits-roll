import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { backtest, evaluate, numericReport } from './backtest.js';
import { Matcher } from '../matcher/index.js';
import { FakeJudge } from '../matcher/fake-judge.js';
import { FakeEmbeddings } from '../ai/fake.js';
import { main } from './cli.js';

test('metrics count missed and incorrect detections and handle zero denominators', () => {
  const labels = [
    { windowId: 'w', messageId: 'a', changed: true },
    { windowId: 'w', messageId: 'b', changed: false },
    { windowId: 'w', messageId: 'c', changed: true },
  ];
  const result = evaluate(
    labels,
    new Set([JSON.stringify(['w', 'a']), JSON.stringify(['w', 'b'])]),
  );
  expect(result).toEqual({ precision: 0.5, recall: 0.5, f1: 0.5, tp: 1, fp: 1, fn: 1, tn: 0 });
  expect(evaluate([], new Set()).f1).toBe(0);
  expect(() => evaluate([], new Set(['unlabeled']))).toThrow('no label');
});

test('synthetic backtest is deterministic, offline, and writes a numeric-only report', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Unexpected network');
  });
  try {
    const root = fileURLToPath(new URL('../../../eval/', import.meta.url));
    const metrics = await backtest(
      {
        transcript: `${root}/sample/transcript.jsonl`,
        chat: `${root}/sample/chat.jsonl`,
        labels: `${root}/sample/labels.jsonl`,
      },
      new Matcher(new FakeJudge(), new FakeEmbeddings()),
    );
    expect(metrics).toMatchObject({ tp: 16, fp: 2, fn: 2, tn: 16 });
    expect(numericReport(metrics)).toMatch(/^[\d.\s]+$/);
    const report = (await readFile(`${root}/RESULTS.md`, 'utf8')).replace(/\r\n/g, '\n');
    expect(report).toBe(numericReport(metrics));
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});

test('real-judge evaluation requires explicit opt-in and cannot overwrite the offline golden', async () => {
  await expect(main(['--real-judge', '--write-results'])).rejects.toThrow('offline golden');
  vi.stubEnv('OPENAI_API_KEY', '');
  try {
    await expect(main(['--real-judge'])).rejects.toThrow('OPENAI_API_KEY');
  } finally {
    vi.unstubAllEnvs();
  }
});
