import { expect, test } from 'vitest';
import { OFFLINE_ENVIRONMENT, setupPanel } from './setup.js';
import type { SetupInput } from './setup.js';

const ready: SetupInput = {
  accounts: {
    streamer: { id: 'streamer-id', login: 'syntheticstreamer' },
    bot: { id: 'bot-id', login: 'syntheticbot' },
  },
  oauthConfigured: true,
  overlayConnected: true,
  overlayUrl: 'http://localhost:4321/overlay/',
  environment: {
    liveEnabled: true,
    apiKeyPresent: true,
    tools: { streamlink: true, ffmpeg: true },
    listening: false,
  },
};

test('offline setup explains missing accounts and providers without blocking the credential-free demo', () => {
  const panel = setupPanel({
    ...ready,
    accounts: {},
    oauthConfigured: false,
    overlayConnected: false,
    environment: OFFLINE_ENVIRONMENT,
  });
  expect(panel.steps.map((step) => step.done)).toEqual([false, false, false, false]);
  expect(panel.canStart).toBe(false);
  expect(panel.steps[0]?.details.join(' ')).toContain('demo works without Twitch');
  expect(panel.steps[3]?.details.join(' ')).toContain('OPENAI_API_KEY is missing');
  expect(panel.steps[3]?.details.join(' ')).toContain('has not been checked');
  expect(panel.overlayUrl).toBe('http://localhost:4321/overlay/');
});

test.each([
  { name: 'streamlink', tools: { streamlink: false, ffmpeg: true } },
  { name: 'ffmpeg', tools: { streamlink: true, ffmpeg: false } },
])('names the missing $name tool and why live audio needs it', ({ name, tools }) => {
  const panel = setupPanel({ ...ready, environment: { ...ready.environment, tools } });
  expect(panel.canStart).toBe(false);
  expect(panel.steps[3]?.done).toBe(false);
  expect(panel.steps[3]?.details.join(' ')).toContain(`${name} is not installed or not on PATH`);
  expect(panel.steps[3]?.details.join(' ')).toContain('the demo works without it');
});

test('connected accounts and tools are ready but listening is only done while running', () => {
  const panel = setupPanel(ready);
  expect(panel.steps.map((step) => step.done)).toEqual([true, true, true, false]);
  expect(panel.canStart).toBe(true);
  expect(panel.steps[3]?.details.join(' ')).toContain('Go live on Twitch');
  const running = setupPanel({ ...ready, environment: { ...ready.environment, listening: true } });
  expect(running.steps.every((step) => step.done)).toBe(true);
});

test('same-account state warns and blocks listening even if the saved tokens are otherwise ready', () => {
  const panel = setupPanel({
    ...ready,
    accounts: { streamer: ready.accounts.streamer!, bot: ready.accounts.streamer! },
  });
  expect(panel.sameAccount).toBe(true);
  expect(panel.canStart).toBe(false);
  expect(panel.steps[1]?.done).toBe(false);
  expect(panel.steps[1]?.details.join(' ')).toContain('Disconnect the bot');
});

test('a browser connection is described honestly instead of claiming OBS is configured', () => {
  const disconnected = setupPanel({ ...ready, overlayConnected: false });
  expect(disconnected.steps[2]?.done).toBe(false);
  const connected = setupPanel(ready);
  expect(connected.steps[2]?.done).toBe(true);
  expect(connected.steps[2]?.details.join(' ')).toContain('Confirm it is visible in OBS');
});
