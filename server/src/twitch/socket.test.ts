import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { expect, test, vi } from 'vitest';
import { LiveChatSource } from './live.js';
import { parseEventSub } from './parser.js';

class FakeSocket extends EventEmitter {
  close = vi.fn(() => {
    this.emit('close');
  });
  terminate = () => this.close();
  packet(value: unknown) {
    this.emit('message', JSON.stringify(value));
  }
}
const welcome = {
  metadata: { message_type: 'session_welcome' },
  payload: { session: { id: 'session', keepalive_timeout_seconds: 10 } },
};
const redeemed = {
  metadata: {
    message_type: 'notification',
    subscription_type: 'channel.channel_points_custom_reward_redemption.add',
    message_id: 'delivery',
  },
  payload: {
    event: {
      id: 'redemption',
      broadcaster_user_id: 'channel',
      user_id: 'viewer',
      user_login: 'viewer',
      reward: { id: 'reward' },
      status: 'unfulfilled',
    },
  },
};

test('parses redemption and stream-end events', () => {
  expect(parseEventSub(JSON.stringify(redeemed))).toMatchObject({
    type: 'redemption',
    redemption: { id: 'redemption' },
  });
  expect(
    parseEventSub(
      JSON.stringify({
        metadata: {
          message_type: 'notification',
          subscription_type: 'stream.offline',
          message_id: 'offline',
        },
        payload: { event: { broadcaster_user_id: 'channel' } },
      }),
    ),
  ).toMatchObject({ type: 'offline', broadcasterId: 'channel' });
});

test('fake socket subscribes, deduplicates redemptions and hands over reconnects', async () => {
  const sockets: FakeSocket[] = [];
  const subscribe = vi.fn(async () => undefined);
  const onEvent = vi.fn();
  const controller = new AbortController();
  const source = new LiveChatSource(
    { clientId: 'client', accessToken: 'synthetic', broadcasterId: 'channel', userId: 'channel' },
    vi.fn(),
    {
      subscribe,
      onEvent,
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    },
  );
  const running = source.run(() => undefined, controller.signal);
  sockets[0]!.packet(welcome);
  await Promise.resolve();
  expect(subscribe).toHaveBeenCalledOnce();
  sockets[0]!.packet(redeemed);
  sockets[0]!.packet(redeemed);
  await Promise.resolve();
  await Promise.resolve();
  expect(onEvent).toHaveBeenCalledOnce();
  sockets[0]!.packet({
    metadata: { message_type: 'session_reconnect' },
    payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=synthetic' } },
  });
  sockets[1]!.packet(welcome);
  expect(sockets[0]!.close).toHaveBeenCalledOnce();
  expect(subscribe).toHaveBeenCalledOnce();
  controller.abort();
  await running;
});
