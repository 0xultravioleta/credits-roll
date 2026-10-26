import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FakeJudge } from '../matcher/fake-judge.js';
import { Matcher } from '../matcher/index.js';
import { FakeEmbeddings } from '../ai/fake.js';
import { backtest, saveNumericReport } from './backtest.js';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const write = args.includes('--write-results');
  const files = args.filter((arg) => arg !== '--write-results');
  if (files.length !== 0 && files.length !== 3)
    throw new Error('Provide transcript.jsonl, chat.jsonl and labels.jsonl, in that order');
  const paths = files.length
    ? files.map((path) => resolve(path))
    : ['transcript', 'chat', 'labels'].map((name) => resolve(root, `eval/sample/${name}.jsonl`));
  const metrics = await backtest(
    { transcript: paths[0]!, chat: paths[1]!, labels: paths[2]! },
    new Matcher(new FakeJudge(), new FakeEmbeddings()),
  );
  if (write) await saveNumericReport(resolve(root, 'eval/RESULTS.md'), metrics);
  console.log(
    `Precision: ${metrics.precision.toFixed(6)}\nRecall: ${metrics.recall.toFixed(6)}\nF1: ${metrics.f1.toFixed(6)}\nTP: ${metrics.tp} FP: ${metrics.fp} FN: ${metrics.fn} TN: ${metrics.tn}`,
  );
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(() => {
    console.error(
      'Evaluation failed. Check file formats and label coverage; no source data was logged.',
    );
    process.exitCode = 1;
  });
}
