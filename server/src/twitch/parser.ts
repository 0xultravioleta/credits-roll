import type { ChatMessage } from '../domain.js';
import { object, text, validLogin } from './source.js';

export type EventSubEvent =
  | { type: 'welcome'; sessionId: string; keepaliveSeconds: number }
  | { type: 'keepalive' }
  | { type: 'reconnect'; url: string }
  | { type: 'revocation' }
  | {
      type: 'chat';
      deliveryId: string;
      broadcasterId: string;
      sourceBroadcasterId?: string;
      message: ChatMessage;
    };

// Pure parser: malformed/unknown events cannot reach judging or expose their raw contents.
export function parseEventSub(raw: string): EventSubEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = object(parsed);
  const metadata = object(root.metadata);
  const payload = object(root.payload);
  const session = object(payload.session);
  switch (metadata.message_type) {
    case 'session_welcome':
      if (
        !text(session.id, 512) ||
        typeof session.keepalive_timeout_seconds !== 'number' ||
        session.keepalive_timeout_seconds < 1 ||
        session.keepalive_timeout_seconds > 600
      )
        return null;
      return {
        type: 'welcome',
        sessionId: session.id,
        keepaliveSeconds: session.keepalive_timeout_seconds,
      };
    case 'session_keepalive':
      return { type: 'keepalive' };
    case 'session_reconnect': {
      if (typeof session.reconnect_url !== 'string') return null;
      try {
        const url = new URL(session.reconnect_url);
        if (
          url.protocol !== 'wss:' ||
          url.hostname !== 'eventsub.wss.twitch.tv' ||
          url.username ||
          url.password ||
          url.port
        )
          return null;
        return { type: 'reconnect', url: session.reconnect_url };
      } catch {
        return null;
      }
    }
    case 'revocation':
      return { type: 'revocation' };
    case 'notification': {
      if (metadata.subscription_type !== 'channel.chat.message') return null;
      const event = object(payload.event);
      const message = object(event.message);
      const sentAt =
        typeof metadata.message_timestamp === 'string'
          ? Date.parse(metadata.message_timestamp)
          : NaN;
      if (
        !text(metadata.message_id, 128) ||
        !text(event.message_id, 128) ||
        !text(event.broadcaster_user_id, 128) ||
        !text(event.chatter_user_id, 128) ||
        !validLogin(event.chatter_user_login) ||
        !text(message.text) ||
        !Number.isFinite(sentAt)
      )
        return null;
      return {
        type: 'chat',
        deliveryId: metadata.message_id,
        broadcasterId: event.broadcaster_user_id,
        sourceBroadcasterId:
          typeof event.source_broadcaster_user_id === 'string'
            ? event.source_broadcaster_user_id
            : undefined,
        message: {
          id: event.message_id,
          viewer: { id: event.chatter_user_id, login: event.chatter_user_login },
          text: message.text,
          sentAt,
        },
      };
    }
    default:
      return null;
  }
}
