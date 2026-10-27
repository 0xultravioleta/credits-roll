import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { Store } from '../store/index.js';
import { FileSupervisorAlerts, supervisorAlertPath } from '../runtime/supervisor-alert.js';
import { listeningLabel, goLiveChecklist, DashboardConnection } from '../../public/dashboard.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
test('header shows real audio/chat ages, standby, blocked reason and last-known status on reconnect', () => {
  const status = {
    listening: true,
    phase: 'listening',
    reason: 'Receiving stream audio.',
    lastAudioAt: 5000,
    lastChatAt: null,
  };
  expect(listeningLabel(status, 8000)).toContain(
    '*** Listening — last audio 3 s ago; last chat not received yet',
  );
  expect(listeningLabel(status, 8000, true)).toContain('Reconnecting... Last known: *** Listening');
  expect(
    listeningLabel({
      ...status,
      listening: false,
      phase: 'standby',
      reason: 'Waiting for Twitch.',
    }),
  ).toBe('~ Standby — Waiting for Twitch.');
  expect(
    listeningLabel({
      ...status,
      listening: false,
      phase: 'connecting',
      reason: 'Retrying in 20 seconds.',
    }),
  ).toBe('x Not listening — Retrying in 20 seconds.');
});
test('go-live checklist covers roles, verified regular channel, permission grants, overlay and actual audio', async () => {
  const store = new Store();
  const { app } = createApp({ store });
  cleanup.push(async () => {
    await app.close();
    store.close();
  });
  const state = (await app.inject('/dashboard/api/state')).json();
  expect(goLiveChecklist(state)).toHaveLength(5);
  expect(goLiveChecklist(state).every((row: { done: boolean }) => !row.done)).toBe(true);
  expect(state.settings.autoListen).toBe(true);
  const stateFetcher = async () => Response.json(state);
  const connection = new DashboardConnection(stateFetcher);
  await connection.refresh();
  expect(connection.state.listeningStatus.listening).toBe(false);
});
test('restart-limit alert survives new app instances, exposes no input text, and clears only with CSRF acknowledgement', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'credits-alert-'));
  const path = join(directory, 'supervisor-alert.json');
  const root = process.cwd();
  cleanup.push(async () => rmSync(directory, { recursive: true }));
  const first = new FileSupervisorAlerts(path, root);
  first.exhausted();
  const second = new FileSupervisorAlerts(path, root);
  expect(second.read()).toEqual(first.read());
  expect(Object.keys(second.read()!)).toEqual([
    'id',
    'time',
    'reason',
    'restarts',
    'windowMinutes',
  ]);
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  const store = new Store();
  const { app } = createApp({ store, supervisorAlerts: second });
  try {
    const state = (await app.inject('/dashboard/api/state')).json();
    expect(state.supervisorAlert.reason).toBe('restart-limit');
    expect(
      (await app.inject({ method: 'POST', url: '/dashboard/api/supervisor/clear' })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/dashboard/api/supervisor/clear',
          headers: { 'x-credits-csrf': state.csrf },
        })
      ).statusCode,
    ).toBe(200);
    expect(new FileSupervisorAlerts(path, root).read()).toBeNull();
    expect(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).toBe('null\n');
  } finally {
    await app.close();
    store.close();
  }
});
test('supervisor alert path cannot overwrite tokens, ledger or diagnostics', () => {
  const ledger = join(tmpdir(), 'synthetic-ledger.jsonl');
  expect(() =>
    supervisorAlertPath({ CREDITS_LEDGER_PATH: ledger, CR_SUPERVISOR_ALERT_PATH: ledger }),
  ).toThrow('own file');
  expect(() => new FileSupervisorAlerts(join(process.cwd(), 'status.json'), process.cwd())).toThrow(
    'outside',
  );
});
test('restart restores saved auto-listen settings but never restores a stale Listening claim', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'credits-restart-state-'));
  const db = join(directory, 'store.sqlite');
  cleanup.push(async () => rmSync(directory, { recursive: true }));
  let store = new Store(db);
  let current = createApp({ store });
  current.dashboard.saveSettings({ ...current.dashboard.getSettings(), autoListen: false });
  await current.app.close();
  store.close();
  store = new Store(db);
  current = createApp({ store });
  try {
    expect((await current.app.inject('/health')).json()).toMatchObject({
      autoListen: false,
      listening: false,
      lastAudioAt: null,
      lastChatAt: null,
    });
    expect((await current.app.inject('/dashboard/api/state')).json().listeningStatus.phase).toBe(
      'not-listening',
    );
  } finally {
    await current.app.close();
    store.close();
  }
});
