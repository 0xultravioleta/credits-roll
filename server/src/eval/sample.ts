import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { positiveFixtures, negativeFixtures } from '../matcher/fixtures.js';
import { spanishFixtures } from '../matcher/spanish-fixtures.js';

// Synthetic fixtures only. The extra cases intentionally expose limits of keyword judging.
const cases = [
  ...positiveFixtures.map((row) => ({ ...row, changed: true })),
  ...negativeFixtures.map((row) => ({ ...row, changed: false })),
  ...spanishFixtures.map((row) => ({ ...row, language: 'es' })),
  {
    chat: 'Use the northern bridge',
    transcript: 'Buena idea, voy por el puente del norte.',
    language: 'es',
    changed: true,
  },
  {
    chat: 'Take the northern bridge',
    transcript: 'You found a shortcut; crossing the north bridge now.',
    changed: true,
  },
  {
    chat: 'Paint the sky purple',
    transcript: "I'm reading a suggestion: paint the sky purple. I'll keep the sky blue.",
    changed: false,
  },
  {
    chat: 'Press the red switch',
    transcript: 'Good idea from last week: press the red switch. I planned this before chat.',
    changed: false,
  },
];
const directory = fileURLToPath(new URL('../../../eval/sample/', import.meta.url));
await mkdir(directory, { recursive: true });
const transcript: object[] = [];
const chat: object[] = [];
const labels: object[] = [];
cases.forEach((row, index) => {
  const offset = index * 120_000;
  const windowId = `window-${index + 1}`;
  const messageId = `message-${index + 1}`;
  transcript.push({
    id: windowId,
    startMs: offset + 5000,
    endMs: offset + 10000,
    text: row.transcript,
    language: 'language' in row ? row.language : 'en',
  });
  chat.push({
    atMs: offset + 1000,
    id: messageId,
    viewer: { id: `synthetic-${index + 1}`, login: `eval_viewer_${index + 1}` },
    text: row.chat,
  });
  labels.push({ windowId, messageId, changed: row.changed });
});
for (const [name, rows] of [
  ['transcript', transcript],
  ['chat', chat],
  ['labels', labels],
] as const)
  await writeFile(
    `${directory}/${name}.jsonl`,
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  );
