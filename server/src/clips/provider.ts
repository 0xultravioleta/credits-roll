import type { ClipProvider, PublishedClip, VodMarker } from './types.js';
import { CLIP_RULES, safeClipUrl, safeThumbnail, trimMediaText } from './types.js';
import type { TwitchApi } from '../twitch/helix.js';
import { object, text } from '../twitch/source.js';
import { withDeadline } from '../runtime/time.js';

function rows(value: unknown): unknown[] {
  const data = object(value).data;
  if (!Array.isArray(data)) throw new Error('Invalid Twitch media response');
  return data;
}
export class HelixClipProvider implements ClipProvider {
  readonly mode = 'live' as const;
  constructor(private readonly api: TwitchApi) {}
  async create(channelId: string, title: string, signal: AbortSignal): Promise<{ id: string }> {
    const result = object(
      rows(
        await withDeadline(
          (deadline) =>
            this.api.request('streamer', 'clips', {
              method: 'POST',
              query: {
                broadcaster_id: channelId,
                title: trimMediaText(title, CLIP_RULES.titleLimit),
                duration: String(CLIP_RULES.durationSeconds),
              },
              signal: deadline,
            }),
          10_000,
          signal,
        ),
      )[0],
    );
    if (!text(result.id, 128) || !/^[\w-]+$/.test(result.id))
      throw new Error('Invalid Twitch clip ID');
    return { id: result.id };
  }
  async get(id: string, signal: AbortSignal): Promise<PublishedClip | null> {
    const data = rows(
      await withDeadline(
        (deadline) => this.api.request('streamer', 'clips', { query: { id }, signal: deadline }),
        10_000,
        signal,
      ),
    );
    if (!data.length) return null;
    const result = object(data[0]);
    if (result.id !== id || !safeClipUrl(result.url) || !safeThumbnail(result.thumbnail_url))
      throw new Error('Invalid Twitch clip metadata');
    return { id, url: result.url, thumbnailUrl: result.thumbnail_url };
  }
  async marker(channelId: string, description: string, signal: AbortSignal): Promise<VodMarker> {
    const result = object(
      rows(
        await withDeadline(
          (deadline) =>
            this.api.request('streamer', 'streams/markers', {
              method: 'POST',
              body: {
                user_id: channelId,
                description: trimMediaText(description, CLIP_RULES.markerLimit),
              },
              signal: deadline,
            }),
          10_000,
          signal,
        ),
      )[0],
    );
    const id = String(result.id ?? '');
    if (
      !/^[\w-]{1,128}$/.test(id) ||
      !Number.isSafeInteger(result.position_seconds) ||
      Number(result.position_seconds) < 0
    )
      throw new Error('Invalid Twitch marker');
    return { id, positionSeconds: Number(result.position_seconds) };
  }
}
export class FakeClipProvider implements ClipProvider {
  readonly mode = 'demo' as const;
  private sequence = 0;
  async create(_channel: string, title: string, signal: AbortSignal): Promise<{ id: string }> {
    signal.throwIfAborted();
    void title;
    return { id: 'demo-' + ++this.sequence };
  }
  async get(id: string, signal: AbortSignal): Promise<PublishedClip> {
    signal.throwIfAborted();
    return { id, url: '/demo/clip/' + id, thumbnailUrl: '/demo/clip-thumbnail.svg' };
  }
  async marker(channel: string, description: string, signal: AbortSignal): Promise<VodMarker> {
    signal.throwIfAborted();
    void channel;
    void description;
    return { id: 'demo-marker', positionSeconds: 20 };
  }
}
