import WebSocket from 'ws';
import type { ChatHandler, ChatSource } from './source.js';
import { parseEventSub } from './parser.js';

export interface TwitchConfig {
  clientId: string;
  accessToken: string;
  broadcasterId: string;
  userId: string;
}

export function twitchConfig(env: NodeJS.ProcessEnv = process.env): TwitchConfig | undefined {
  const {
    TWITCH_CLIENT_ID: clientId,
    TWITCH_ACCESS_TOKEN: accessToken,
    TWITCH_BROADCASTER_ID: broadcasterId,
    TWITCH_USER_ID: userId,
  } = env;
  if (!clientId || !accessToken || !broadcasterId || !userId) return undefined;
  return { clientId, accessToken, broadcasterId, userId };
}

const ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws';

export class LiveChatSource implements ChatSource {
  constructor(
    private readonly config: TwitchConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async run(onMessage: ChatHandler, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (Object.values(this.config).some((value) => !value))
      throw new Error('Twitch configuration is incomplete');
    await new Promise<void>((resolve, reject) => {
      const sockets = new Set<WebSocket>();
      const watchdogs = new Map<WebSocket, ReturnType<typeof setTimeout>>();
      const seen = new Map<string, number>();
      let active: WebSocket | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let retryMs = 1000;
      let stopped = false;
      let queue = Promise.resolve();

      const cleanup = () => {
        stopped = true;
        signal.removeEventListener('abort', abort);
        if (retry) clearTimeout(retry);
        for (const timer of watchdogs.values()) clearTimeout(timer);
        for (const socket of sockets) socket.close();
        seen.clear();
      };
      const fail = (message: string) => {
        if (!stopped) {
          cleanup();
          reject(new Error(message));
        }
      };
      const abort = () => {
        cleanup();
        void queue.then(resolve, resolve);
      };
      const reconnect = () => {
        if (stopped || retry) return;
        retry = setTimeout(() => {
          retry = undefined;
          connect(ENDPOINT);
        }, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      };
      const connect = (url: string, previous?: WebSocket) => {
        if (stopped) return;
        const socket = new WebSocket(url, { maxPayload: 64 * 1024, handshakeTimeout: 10_000 });
        sockets.add(socket);
        let keepaliveMs = 10_000;
        const armWatchdog = () => {
          clearTimeout(watchdogs.get(socket));
          watchdogs.set(
            socket,
            setTimeout(() => socket.terminate(), keepaliveMs + 1000),
          );
        };
        armWatchdog();
        socket.on('error', () => {
          /* Close drives retries; never log network objects with tokens. */
        });
        socket.on('close', () => {
          clearTimeout(watchdogs.get(socket));
          watchdogs.delete(socket);
          sockets.delete(socket);
          if (socket === active) active = undefined;
          if (!active && sockets.size === 0) reconnect();
        });
        socket.on('message', (data) => {
          const event = parseEventSub(data.toString());
          if (!event || stopped) return;
          armWatchdog();
          if (event.type === 'welcome') {
            active = socket;
            retryMs = 1000;
            keepaliveMs = event.keepaliveSeconds * 1000;
            armWatchdog();
            if (previous) {
              previous.close();
              return;
            }
            void this.request('https://api.twitch.tv/helix/eventsub/subscriptions', {
              method: 'POST',
              signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
              headers: {
                'Client-Id': this.config.clientId,
                Authorization: `Bearer ${this.config.accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                type: 'channel.chat.message',
                version: '1',
                condition: {
                  broadcaster_user_id: this.config.broadcasterId,
                  user_id: this.config.userId,
                },
                transport: { method: 'websocket', session_id: event.sessionId },
              }),
            })
              .then((response) => {
                if (!response.ok) fail(`Twitch subscription failed (HTTP ${response.status})`);
              })
              .catch(() => {
                if (!signal.aborted) fail('Twitch subscription request failed');
              });
          } else if (event.type === 'reconnect' && socket === active) {
            connect(event.url, socket);
          } else if (event.type === 'revocation') {
            fail('Twitch authorization revoked; reconnect with a valid user token');
          } else if (event.type === 'chat') {
            if (
              event.broadcasterId !== this.config.broadcasterId ||
              (event.sourceBroadcasterId && event.sourceBroadcasterId !== this.config.broadcasterId)
            )
              return;
            const now = Date.now();
            for (const [id, at] of seen) {
              if (at < now - 600_000) seen.delete(id);
            }
            if (seen.has(event.deliveryId) || seen.has(event.message.id)) return;
            if (seen.size > 10_000) seen.clear();
            seen.set(event.deliveryId, now);
            seen.set(event.message.id, now);
            queue = queue.then(async () => {
              if (!stopped) await onMessage(event.message);
            });
            void queue.catch(() => fail('Chat processing failed'));
          }
        });
      };
      signal.addEventListener('abort', abort, { once: true });
      connect(ENDPOINT);
    });
  }
}
