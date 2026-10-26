import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { ChatMessage } from '../domain.js';
import { twitchConfig } from './live.js';
import { parseEventSub } from './parser.js';
import { parseRecordedEntry, RecordedChatSource } from './recorded.js';

const fixtures = readFileSync(new URL('./fixtures/eventsub.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n');
describe('EventSub parser', () => {
  test('parses recorded welcome, chat, keepalive, reconnect and revocation payloads', () => {
    expect(fixtures.map((raw) => parseEventSub(raw)?.type)).toEqual([
      'welcome',
      'chat',
      'keepalive',
      'reconnect',
      'revocation',
    ]);
    expect(parseEventSub(fixtures[1]!)).toMatchObject({
      type: 'chat',
      message: {
        id: 'chat-1',
        viewer: { id: 'viewer-1', login: 'mapmaker' },
        text: 'Try the northern bridge',
        sentAt: Date.parse('2026-10-25T12:00:00.123Z'),
      },
    });
  });
  test.each(['no json', 'null', '{}', '{"metadata":{"message_type":"unknown"}}'])(
    'ignores malformed or unsupported input: %s',
    (raw) => {
      expect(parseEventSub(raw)).toBeNull();
    },
  );
  test('rejects malformed chat and off-domain reconnect URLs', () => {
    expect(parseEventSub(fixtures[1]!.replace('mapmaker', '<script>'))).toBeNull();
    expect(parseEventSub(fixtures[3]!.replace('eventsub.wss.twitch.tv', 'example.com'))).toBeNull();
    expect(
      parseEventSub(fixtures[1]!.replace('channel.chat.message', 'channel.follow')),
    ).toBeNull();
  });
  test('gates live configuration on all required credentials', () => {
    expect(twitchConfig({})).toBeUndefined();
    expect(twitchConfig({ TWITCH_CLIENT_ID: 'id' })).toBeUndefined();
    expect(
      twitchConfig({
        TWITCH_CLIENT_ID: 'id',
        TWITCH_ACCESS_TOKEN: 'synthetic',
        TWITCH_BROADCASTER_ID: 'channel-1',
        TWITCH_USER_ID: 'reader-1',
      })?.userId,
    ).toBe('reader-1');
  });
});

describe('recorded chat source', () => {
  const path = fileURLToPath(new URL('./fixtures/chat.jsonl', import.meta.url));
  test('replays JSONL deterministically and awaits handlers in order', async () => {
    const messages: ChatMessage[] = [];
    await new RecordedChatSource(path, { origin: 1000 }).run(async (message) => {
      await Promise.resolve();
      messages.push(message);
    }, new AbortController().signal);
    expect(messages.map((message) => [message.id, message.sentAt, message.text])).toEqual([
      ['chat-1', 1000, 'Try the northern bridge'],
      ['chat-2', 1100, '!optout'],
    ]);
  });
  test('honors cancellation before and during replay', async () => {
    const controller = new AbortController();
    const messages: ChatMessage[] = [];
    await new RecordedChatSource(path).run((message) => {
      messages.push(message);
      controller.abort();
    }, controller.signal);
    await new RecordedChatSource(path).run((message) => {
      messages.push(message);
    }, controller.signal);
    expect(messages).toHaveLength(1);
  });
  test('validates JSONL entries', () => {
    expect(() => parseRecordedEntry({ atMs: -1 })).toThrow('Invalid recorded');
  });
});
