export const CLIP_RULES = {
  durationSeconds: 60,
  titleLimit: 100,
  markerLimit: 140,
  pollMs: 5000,
  confirmMs: 60_000,
  cooldownMs: 60_000,
  perStream: 20,
  announcementMs: 90_000,
} as const;
// Helix documents no title maximum. titleLimit is our conservative app policy,
// not a measured or documented Twitch limit. Use Unicode code points throughout.
export const trimMediaText = (text: string, limit: number) =>
  Array.from(
    Array.from(text)
      .map((character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character,
      )
      .join('')
      .trim(),
  )
    .slice(0, limit)
    .join('');
export function clipTitle(login: string | undefined, kind: string): string {
  return trimMediaText(
    (login ? '@' + login + ' moved the stream' : 'A viewer moved the stream') + ' - ' + kind,
    CLIP_RULES.titleLimit,
  );
}
export interface PublishedClip {
  id: string;
  url: string;
  thumbnailUrl: string;
}
export interface VodMarker {
  id: string;
  positionSeconds: number;
}
export interface ClipProvider {
  readonly mode: 'live' | 'demo';
  create(channelId: string, title: string, signal: AbortSignal): Promise<{ id: string }>;
  get(id: string, signal: AbortSignal): Promise<PublishedClip | null>;
  marker(channelId: string, description: string, signal: AbortSignal): Promise<VodMarker>;
}
export interface MomentMedia {
  clip: {
    status:
      | 'creating'
      | 'confirming'
      | 'ready'
      | 'pending-unconfirmed'
      | 'restricted'
      | 'offline'
      | 'failed'
      | 'skipped';
    id?: string;
    url?: string;
    thumbnailUrl?: string;
    named?: boolean;
    requestedAt?: number;
    demo?: boolean;
  };
  marker?: {
    status: 'ready' | 'needs-vod' | 'missing-scope' | 'failed';
    id?: string;
    positionSeconds?: number;
  };
}
export function safeClipUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^\/demo\/clip(?:-thumbnail\.svg|\/[a-zA-Z0-9-]+)$/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'clips.twitch.tv' ||
        (['www.twitch.tv', 'twitch.tv'].includes(url.hostname) && url.pathname.includes('/clip/')))
    );
  } catch {
    return false;
  }
}
export function safeThumbnail(value: unknown): value is string {
  if (value === '/demo/clip-thumbnail.svg') return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (/^clips-media-assets\d*\.twitch\.tv$/.test(url.hostname) ||
        url.hostname === 'static-cdn.jtvnw.net')
    );
  } catch {
    return false;
  }
}
export function validateMedia(value: unknown): MomentMedia {
  const row = value as MomentMedia;
  if (
    !row ||
    !row.clip ||
    ![
      'creating',
      'confirming',
      'ready',
      'pending-unconfirmed',
      'restricted',
      'offline',
      'failed',
      'skipped',
    ].includes(row.clip.status) ||
    (row.clip.id !== undefined &&
      (typeof row.clip.id !== 'string' || !/^[\w-]{1,128}$/.test(row.clip.id))) ||
    (row.clip.url !== undefined && !safeClipUrl(row.clip.url)) ||
    (row.clip.thumbnailUrl !== undefined && !safeThumbnail(row.clip.thumbnailUrl)) ||
    (row.clip.named !== undefined && typeof row.clip.named !== 'boolean') ||
    (row.clip.demo !== undefined && typeof row.clip.demo !== 'boolean') ||
    (row.clip.requestedAt !== undefined && !Number.isFinite(row.clip.requestedAt)) ||
    (row.clip.status === 'ready' && (!row.clip.id || !row.clip.url || !row.clip.thumbnailUrl)) ||
    (row.marker &&
      (!['ready', 'needs-vod', 'missing-scope', 'failed'].includes(row.marker.status) ||
        (row.marker.id !== undefined && !/^[\w-]{1,128}$/.test(row.marker.id)) ||
        (row.marker.positionSeconds !== undefined &&
          (!Number.isSafeInteger(row.marker.positionSeconds) || row.marker.positionSeconds < 0))))
  )
    throw new Error('Invalid credit media');
  return { clip: { ...row.clip }, ...(row.marker ? { marker: { ...row.marker } } : {}) };
}
