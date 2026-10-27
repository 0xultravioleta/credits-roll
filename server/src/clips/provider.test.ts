import { expect, test, vi } from 'vitest';
import { Helix, TwitchApiError } from '../twitch/helix.js';
import { FakeClipProvider, HelixClipProvider } from './provider.js';
import { clipTitle, CLIP_RULES, trimMediaText } from './types.js';

function provider(replies: Response[]) {
  const request = vi.fn<typeof fetch>(async () => replies.shift()!);
  const api = new Helix(
    {
      config: {
        clientId: 'synthetic',
        clientSecret: 'synthetic',
        redirectUri: 'http://localhost:3101/auth/callback',
      },
      accessToken: async () => 'synthetic',
    },
    request,
  );
  return { clips: new HelixClipProvider(api), request };
}
test('Helix accepts a 202 clip job and sends documented query parameters with streamer authorization', async () => {
  const { clips, request } = provider([
    Response.json({ data: [{ id: 'ClipOne' }] }, { status: 202 }),
  ]);
  await expect(
    clips.create('channel', clipTitle('mapmaker', 'idea'), new AbortController().signal),
  ).resolves.toEqual({ id: 'ClipOne' });
  const [input, options] = request.mock.calls[0]!;
  const url = new URL(String(input));
  expect(url.pathname).toBe('/helix/clips');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    broadcaster_id: 'channel',
    title: '@mapmaker moved the stream - idea',
    duration: '60',
  });
  expect(options?.method).toBe('POST');
});
test('confirmation distinguishes an unpublished clip and a confirmed public clip', async () => {
  const { clips } = provider([
    Response.json({ data: [] }),
    Response.json({
      data: [
        {
          id: 'ClipOne',
          url: 'https://clips.twitch.tv/ClipOne',
          thumbnail_url: 'https://clips-media-assets2.twitch.tv/clip.jpg',
        },
      ],
    }),
  ]);
  const signal = new AbortController().signal;
  await expect(clips.get('ClipOne', signal)).resolves.toBeNull();
  await expect(clips.get('ClipOne', signal)).resolves.toMatchObject({
    id: 'ClipOne',
    url: 'https://clips.twitch.tv/ClipOne',
  });
});
test.each([403, 404])(
  'Helix preserves HTTP %i for the independent clip failure policy',
  async (status) => {
    const { clips } = provider([new Response(null, { status })]);
    await expect(
      clips.create('channel', 'A credit', new AbortController().signal),
    ).rejects.toMatchObject({ status });
  },
);
test('marker body uses the 140-character documented bound; no fabricated VOD URL is returned', async () => {
  const { clips, request } = provider([
    Response.json({ data: [{ id: 123, position_seconds: 42 }] }),
  ]);
  await expect(
    clips.marker('channel', '@mapmaker: ' + '🙂'.repeat(150), new AbortController().signal),
  ).resolves.toEqual({ id: '123', positionSeconds: 42 });
  const body = JSON.parse(String(request.mock.calls[0]![1]?.body));
  expect(Array.from(body.description)).toHaveLength(140);
  expect(body.user_id).toBe('channel');
});
test('titles omit an opted-out login and apply an app limit without splitting Unicode', () => {
  expect(clipTitle(undefined, 'idea')).toBe('A viewer moved the stream - idea');
  expect(clipTitle(undefined, 'idea')).not.toContain('mapmaker');
  expect(Array.from(trimMediaText('🙂'.repeat(150), CLIP_RULES.titleLimit))).toHaveLength(100);
});
test('untrusted clip URLs and thumbnails never reach an overlay', async () => {
  const { clips } = provider([
    Response.json({
      data: [
        {
          id: 'ClipOne',
          url: 'javascript:alert(1)',
          thumbnail_url: 'https://attacker.invalid/track',
        },
      ],
    }),
  ]);
  await expect(clips.get('ClipOne', new AbortController().signal)).rejects.toThrow(
    'Invalid Twitch clip metadata',
  );
});
test('the demo provider supplies only local URLs and does not use fetch', async () => {
  const clips = new FakeClipProvider();
  const job = await clips.create('demo', 'Demo clip', new AbortController().signal);
  expect(await clips.get(job.id, new AbortController().signal)).toMatchObject({
    thumbnailUrl: '/demo/clip-thumbnail.svg',
  });
  expect(clips.mode).toBe('demo');
  expect(new TwitchApiError(403).message).not.toContain('token');
});
