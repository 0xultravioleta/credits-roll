import { expect, test } from 'vitest';
import { DashboardConnection } from '../../public/dashboard.js';

test('native fetch receiver stays undefined or globalThis', async () => {
  let requested = false;
  const fetcher = function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    requested = true;
    return Promise.resolve(
      Response.json({
        csrf: 'synthetic',
        accounts: {},
        settings: {},
        setup: { steps: [] },
        activity: [],
        transcripts: [],
      }),
    );
  };
  const connection = new DashboardConnection(fetcher);
  const result = await connection.refresh();
  expect(requested, 'native fetch must actually issue its request').toBe(true);
  expect(result.reconnecting).toBe(false);
  expect(result.state).not.toBeNull();
});
