import { afterEach, expect, test, vi } from 'vitest';
import { BotFilter, DEFAULT_IGNORED_LOGINS } from './bot-filter.js';
import { Store } from '../store/index.js';
import { createApp } from '../app.js';
import { Pipeline } from '../pipeline.js';
import { Matcher } from '../matcher/index.js';
import { FakeTranscriber } from '../ai/fake.js';
import { parseEventSub } from './parser.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

test.each(DEFAULT_IGNORED_LOGINS)(
  'default service account %s never reaches the matcher',
  async (login) => {
    const store = new Store();
    const { app, hub, scoring } = createApp({ store });
    const judge = { judge: vi.fn(async () => []) };
    const matcher = new Matcher(judge);
    const match = vi.spyOn(matcher, 'match');
    const pipeline = new Pipeline({
      store,
      hub,
      scoring,
      matcher,
      transcriber: new FakeTranscriber(),
    });
    cleanup.push(async () => {
      pipeline.close();
      await app.close();
      store.close();
    });
    const now = Date.now();
    pipeline.addChat({
      id: 'synthetic',
      viewer: { id: 'service', login: login.toUpperCase() },
      text: 'Try the northern bridge',
      sentAt: now - 1000,
    });
    await pipeline.processWindow({
      id: 'window',
      streamId: 'stream',
      startAt: now,
      endAt: now,
      text: "Good idea, I'll try the northern bridge.",
    });
    expect(match.mock.calls[0]![1]).toEqual([]);
    expect(judge.judge).not.toHaveBeenCalled();
  },
);

test('filters connected roles by ID, extra logins without case sensitivity, and learned bot IDs after renames', () => {
  const filter = new BotFilter(
    () => [...DEFAULT_IGNORED_LOGINS, 'ExtraBot'],
    () => [
      { id: 'streamer', login: 'syntheticstreamer' },
      { id: 'bot', login: 'syntheticbot' },
    ],
  );
  const row = {
    id: 'm',
    text: 'Synthetic message',
    sentAt: 0,
    viewer: { id: 'extra', login: 'extrabot' },
  };
  expect(filter.ignores(row)).toBe(true);
  expect(filter.ignores({ ...row, viewer: { id: 'extra', login: 'renamed' } })).toBe(true);
  for (const id of ['streamer', 'bot'])
    expect(filter.ignores({ ...row, viewer: { id, login: 'renamed' } })).toBe(true);
  expect(filter.ignores({ ...row, viewer: { id: 'human', login: 'syntheticviewer' } })).toBe(false);
});

test('EventSub carries a bot badge into the filter without excluding ordinary moderators', () => {
  const payload = (set_id: string) =>
    JSON.stringify({
      metadata: {
        message_type: 'notification',
        subscription_type: 'channel.chat.message',
        message_id: 'delivery',
        message_timestamp: '2026-10-26T12:00:00Z',
      },
      payload: {
        event: {
          message_id: 'chat',
          broadcaster_user_id: 'channel',
          chatter_user_id: 'viewer',
          chatter_user_login: 'syntheticviewer',
          message: { text: 'Synthetic output' },
          badges: [{ set_id }],
        },
      },
    });
  const bot = parseEventSub(payload('bot-badge'));
  const human = parseEventSub(payload('moderator'));
  expect(bot?.type === 'chat' && new BotFilter().ignores(bot.message)).toBe(true);
  expect(human?.type === 'chat' && new BotFilter().ignores(human.message)).toBe(false);
});

test('an opted-out bot stays absent from diagnostics after startup with an empty debug log', () => {
  const store = new Store();
  store.optOut('blocked-bot');
  const { app, hub, scoring, debug } = createApp({ store });
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    debug,
    matcher: new Matcher({ judge: async () => [] }),
    transcriber: new FakeTranscriber(),
  });
  cleanup.push(async () => {
    pipeline.close();
    await app.close();
    store.close();
  });
  pipeline.addChat({
    id: 'blocked',
    viewer: { id: 'blocked-bot', login: 'Nightbot' },
    text: 'Synthetic private text',
    sentAt: Date.now(),
  });
  expect(debug.snapshot()).toBe('');
});
