import { expect, test, vi } from 'vitest';
import { DashboardConnection } from '../../public/dashboard.js';

function connectedState() {
  return {
    csrf: 'synthetic-csrf',
    accounts: {
      streamer: { id: 's', login: 'syntheticstreamer' },
      bot: { id: 'b', login: 'syntheticbot' },
    },
    settings: { prizeText: 'Choose the next challenge' },
    setup: {
      steps: [
        { id: 'streamer', done: true },
        { id: 'bot', done: true },
      ],
    },
    activity: [],
    transcripts: [],
  };
}

test.each(['network error', 'HTTP failure', 'incomplete response'])(
  'keeps the last connected accounts and checklist on %s',
  async (failure) => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(connectedState()));
    const connection = new DashboardConnection(request);
    const initial = await connection.refresh();
    if (failure === 'network error') request.mockRejectedValueOnce(new Error('Offline'));
    else
      request.mockResolvedValueOnce(
        failure === 'HTTP failure'
          ? new Response(null, { status: 503 })
          : Response.json({ accounts: {} }),
      );
    const disconnected = await connection.refresh();
    expect(disconnected.reconnecting).toBe(true);
    expect(disconnected.state.accounts).toEqual(initial.state.accounts);
    expect(disconnected.state.setup.steps.every((step: { done: boolean }) => step.done)).toBe(true);
    request.mockResolvedValueOnce(Response.json(connectedState()));
    expect((await connection.refresh()).reconnecting).toBe(false);
  },
);

test('shows no invented disconnected state before the first successful response', async () => {
  const connection = new DashboardConnection(vi.fn().mockRejectedValue(new Error('Offline')));
  expect(await connection.refresh()).toMatchObject({ state: null, reconnecting: true });
});

test('concurrent polls share one request and only a successful response changes account status', async () => {
  let finish!: (response: Response) => void;
  const request = vi.fn<typeof fetch>().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const connection = new DashboardConnection(request);
  const first = connection.refresh();
  const second = connection.refresh();
  expect(first).toBe(second);
  expect(request).toHaveBeenCalledTimes(1);
  finish(Response.json(connectedState()));
  await first;
  request.mockResolvedValueOnce(
    Response.json({
      ...connectedState(),
      accounts: {},
      setup: { steps: [{ id: 'streamer', done: false }] },
    }),
  );
  const updated = await connection.refresh();
  expect(updated.reconnecting).toBe(false);
  expect(updated.state.accounts).toEqual({});
  expect(updated.state.setup.steps[0].done).toBe(false);
});

test('reconnecting retains setup while expiring cached text at the privacy deadlines', async () => {
  let now = 1000;
  const moment = {
    occurredAt: 1000,
    quote: 'Synthetic suggestion',
    adoptionExcerpt: 'Synthetic adoption',
  };
  const row = { momentCount: 1, lastCreditedAt: 1000, moments: [moment] };
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
    Response.json({
      ...connectedState(),
      activity: [{ text: 'Synthetic chat' }],
      transcripts: [{ text: 'Synthetic speech' }],
      creditedViewerLists: { current: [row], recent: [row] },
    }),
  );
  const connection = new DashboardConnection(request, () => now);
  await connection.refresh();
  request.mockRejectedValue(new Error('Offline'));
  now += 90_000;
  const transientExpired = await connection.refresh();
  expect(transientExpired.state.activity).toEqual([]);
  expect(transientExpired.state.transcripts).toEqual([]);
  expect(transientExpired.state.creditedViewerLists.current).toHaveLength(1);
  now = 1000 + 72 * 60 * 60 * 1000;
  const historyExpired = await connection.refresh();
  expect(historyExpired.state.creditedViewerLists).toEqual({ current: [], recent: [] });
  expect(historyExpired.state.setup.steps.every((step: { done: boolean }) => step.done)).toBe(true);
});
