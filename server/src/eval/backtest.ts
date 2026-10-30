import { readFile, writeFile } from 'node:fs/promises';
import { RecordedChatSource } from '../twitch/recorded.js';
import { readTranscript } from '../transcript/recorded.js';
import { object, text } from '../twitch/source.js';
import { Matcher } from '../matcher/index.js';
import type { ChatMessage } from '../domain.js';

export interface Label {
  windowId: string;
  messageId: string;
  changed: boolean;
}
export interface Metrics {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}
const pair = (windowId: string, messageId: string) => JSON.stringify([windowId, messageId]);

export function evaluate(labels: Label[], predictions: ReadonlySet<string>): Metrics {
  const known = new Set<string>();
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const label of labels) {
    const id = pair(label.windowId, label.messageId);
    if (known.has(id)) throw new Error('Duplicate evaluation label');
    known.add(id);
    const predicted = predictions.has(id);
    if (label.changed) {
      if (predicted) tp++;
      else fn++;
    } else {
      if (predicted) fp++;
      else tn++;
    }
  }
  if ([...predictions].some((id) => !known.has(id)))
    throw new Error('An evaluation prediction has no label');
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    tp,
    fp,
    fn,
    tn,
  };
}

export async function backtest(
  paths: { transcript: string; chat: string; labels: string },
  matcher: Matcher,
): Promise<Metrics> {
  const windows = await readTranscript(paths.transcript);
  const chat: ChatMessage[] = [];
  await new RecordedChatSource(paths.chat, { origin: 0 }).run((message) => {
    chat.push(message);
  }, new AbortController().signal);
  const windowIds = new Set(windows.map((window) => window.id));
  const chatIds = new Set(chat.map((message) => message.id));
  if (windowIds.size !== windows.length) throw new Error('Duplicate transcript window id');
  const labels: Label[] = (await readFile(paths.labels, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const row = object(JSON.parse(line));
      if (
        !text(row.windowId, 128) ||
        !text(row.messageId, 128) ||
        typeof row.changed !== 'boolean' ||
        !windowIds.has(row.windowId) ||
        !chatIds.has(row.messageId)
      )
        throw new Error('Invalid evaluation label');
      return { windowId: row.windowId, messageId: row.messageId, changed: row.changed };
    });
  const optedOut = new Set<string>();
  const credited = new Set<string>();
  const predictions = new Set<string>();
  let index = 0;
  let buffer: ChatMessage[] = [];
  for (const window of windows) {
    while (index < chat.length && chat[index]!.sentAt <= window.endMs) {
      const message = chat[index++]!;
      if (/^!(?:optout|forgetme)(?:\s|$)/i.test(message.text.trim())) {
        optedOut.add(message.viewer.id);
        buffer = buffer.filter((row) => row.viewer.id !== message.viewer.id);
      } else if (!optedOut.has(message.viewer.id)) buffer.push(message);
    }
    buffer = buffer.filter(
      (message) => message.sentAt >= window.startMs - 90_000 && !optedOut.has(message.viewer.id),
    );
    const matched = await matcher.match(
      {
        id: window.id,
        streamId: 'evaluation',
        startAt: window.startMs,
        endAt: window.endMs,
        text: window.text,
        language: window.language,
      },
      buffer,
    );
    for (const moment of matched)
      if (!credited.has(moment.messageId)) {
        predictions.add(pair(window.id, moment.messageId));
        credited.add(moment.messageId);
      }
  }
  return evaluate(labels, predictions);
}

// Deliberately no headings, keys, ids, names, chat, code fences or timestamps.
export function numericReport(metrics: Metrics): string {
  return `${[metrics.precision, metrics.recall, metrics.f1].map((value) => value.toFixed(6)).join(' ')} ${metrics.tp} ${metrics.fp} ${metrics.fn} ${metrics.tn}\n`;
}
export async function saveNumericReport(path: string, metrics: Metrics): Promise<void> {
  await writeFile(path, numericReport(metrics), 'utf8');
}
