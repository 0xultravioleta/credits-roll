import { expect, test } from 'vitest';
import type { Moment } from '../../server/src/domain.js';
import { OverlayModel, POPUP_MS } from './state.js';

const moment: Moment = {
  id: 'm',
  messageId: 'c',
  streamId: 's',
  viewer: { id: 'v', login: 'mapmaker' },
  quote: 'Try the bridge',
  kind: 'idea',
  confidence: 0.95,
  occurredAt: Date.now(),
};

test('confirmed media updates an active pop-up and can show a late Clipped pop-up once', () => {
  const model = new OverlayModel();
  const clipped: Moment = {
    ...moment,
    media: {
      clip: {
        status: 'ready',
        id: 'ClipOne',
        url: 'https://clips.twitch.tv/ClipOne',
        thumbnailUrl: 'https://clips-media-assets2.twitch.tv/clip.jpg',
      },
    },
  };
  model.accept({ type: 'moment', moment }, 0);
  model.tick(0);
  model.accept({ type: 'clip', moment: clipped }, 5000);
  expect(model.current?.moment.media?.clip.status).toBe('ready');
  expect(model.current?.startedAt).toBe(5000);
  model.tick(5000 + POPUP_MS);
  model.accept({ type: 'clip', moment: clipped }, 12000);
  model.tick(12000);
  expect(model.current).toBeUndefined();
  const late = new OverlayModel();
  late.accept({ type: 'moment', moment }, 0);
  late.tick(0);
  late.tick(POPUP_MS);
  late.accept({ type: 'clip', moment: clipped }, 9000);
  late.tick(9000);
  expect(late.current?.moment.media?.clip.id).toBe('ClipOne');
  late.accept({ type: 'optout', viewerId: moment.viewer.id }, 9001);
  late.accept({ type: 'clip', moment: clipped }, 9002);
  late.tick(9002);
  expect(late.current).toBeUndefined();
});

test('disconnect reset removes active pop-ups and queued overlay data', () => {
  const model = new OverlayModel();
  model.accept({ type: 'moment', moment }, 0);
  model.tick(0);
  model.accept({ type: 'reset' }, 1);
  model.tick(1);
  expect(model.current).toBeUndefined();
  expect(model.credits).toEqual([]);
});

test('deduplicates replayed pop-ups and advances their queue', () => {
  const model = new OverlayModel();
  model.accept({ type: 'moment', moment }, 0);
  model.accept({ type: 'moment', moment }, 0);
  model.tick(0);
  expect(model.current?.moment.id).toBe('m');
  model.tick(POPUP_MS);
  expect(model.current).toBeUndefined();
});

test('opt-outs immediately remove current and queued pop-ups', () => {
  const model = new OverlayModel();
  model.accept({ type: 'moment', moment }, 0);
  model.accept({ type: 'moment', moment: { ...moment, id: 'second' } }, 0);
  model.tick(0);
  model.accept({ type: 'optout', viewerId: 'v' }, 1);
  model.tick(1);
  expect(model.current).toBeUndefined();
});

test('reconnecting restores credits without restarting an active roll', () => {
  const model = new OverlayModel();
  const event = {
    type: 'snapshot',
    state: { phase: 'credits', streamId: 's', moments: [], credits: [], wheel: [] },
  } as const;
  model.accept({ ...event, state: { ...event.state, moments: [], credits: [], wheel: [] } }, 10);
  expect(model.phase).toBe('credits');
  expect(model.creditsStartedAt).toBe(10);
  model.accept({ ...event, state: { ...event.state, moments: [], credits: [], wheel: [] } }, 20);
  expect(model.creditsStartedAt).toBe(10);
});
