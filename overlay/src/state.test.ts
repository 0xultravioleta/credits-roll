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
