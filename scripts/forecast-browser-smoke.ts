import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { createApp } from '../server/src/app.js';
import { Store } from '../server/src/store/index.js';
import { OAuthAccounts } from '../server/src/auth/oauth.js';
import { SCOPES } from '../server/src/auth/types.js';
import { ForecastService } from '../server/src/predictions/service.js';
import { FakePredictionProvider } from '../server/src/predictions/provider.js';
import type { ForecastView } from '../server/src/predictions/types.js';

export async function forecastBrowserSmoke(executablePath: string, port: number): Promise<void> {
  assert.ok(port === 3101 || port === 3102);
  const store = new Store();
  let clock = Date.now();
  const mapClock = (view: ForecastView): ForecastView => ({
    ...view,
    endsAt: view.endsAt === null ? null : Date.now() + view.endsAt - clock,
    correctionEndsAt:
      view.correctionEndsAt === null ? null : Date.now() + view.correctionEndsAt - clock,
  });
  const accounts = new OAuthAccounts(
    {
      clientId: 'synthetic',
      clientSecret: 'synthetic',
      redirectUri: `http://localhost:${port}/auth/callback`,
    },
    {
      read: () => ({
        streamer: {
          userId: '123',
          login: 'syntheticstreamer',
          accessToken: 'synthetic',
          refreshToken: 'synthetic',
          expiresAt: Date.now() + 3600_000,
          expiresIn: 3600,
          scopes: [...SCOPES.streamer],
        },
      }),
      write: () => {},
    },
    {
      exchange: async () => {
        throw new Error('No OAuth in smoke');
      },
      refresh: async () => {
        throw new Error('No OAuth in smoke');
      },
      validate: async () => {
        throw new Error('No OAuth in smoke');
      },
    },
  );
  const { app, hub, scoring } = createApp({
    store,
    accounts,
    environment: () => ({
      liveEnabled: true,
      apiKeyPresent: true,
      tools: { streamlink: true, ffmpeg: true },
      broadcasterType: 'affiliate',
      listening: true,
      forecast: forecast ? mapClock(forecast.view()) : undefined,
      forecastMoments: forecast?.reviewMoments(),
      entriesRefunded: 1,
    }),
    actions: {
      startForecast: (minutes) => forecast!.start(minutes),
      cancelForecast: () => forecast!.cancel(),
      correctForecast: async (id, excluded) => {
        forecast!.exclude(id, excluded);
      },
    },
  });
  const provider = new FakePredictionProvider(() => clock);
  const forecast = new ForecastService({
    provider,
    store,
    channelId: '123',
    streamId: () => 'synthetic-forecast',
    listening: () => true,
    eligible: () => true,
    scope: () => true,
    timer: false,
    now: () => clock,
    changed: (view) => hub.setForecast(mapClock(view)),
  });
  let browser;
  try {
    const address = await app.listen({ host: '127.0.0.1', port });
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-first-run', '--disable-background-networking'],
    });
    const errors: string[] = [];
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin === address) void request.continue();
      else void request.abort();
    });
    await page.goto(`${address}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !document.querySelector<HTMLButtonElement>('#forecast-start')?.disabled,
    );
    assert.equal(await page.$$eval('#reward-prize option', (options) => options.length), 4);
    await page.$eval('#forecast-minutes', (element) => {
      (element as HTMLInputElement).value = '10';
    });
    await page.click('#forecast-start');
    await page.waitForFunction(
      () =>
        document.getElementById('forecast-status')?.textContent?.includes('counting') === false &&
        document.getElementById('forecast-status')?.textContent?.includes('0/3'),
    );
    const overlay = await browser.newPage();
    await overlay.setRequestInterception(true);
    overlay.on('request', (request) => {
      if (new URL(request.url()).origin === address) void request.continue();
      else void request.abort();
    });
    await overlay.goto(`${address}/overlay/`, { waitUntil: 'domcontentloaded' });
    for (let index = 0; index < 3; index++) {
      const moment = {
        id: `forecast-${index}`,
        messageId: `forecast-chat-${index}`,
        streamId: 'synthetic-forecast',
        viewer: { id: `synthetic-${index}`, login: `synthetic${index}` },
        quote: 'Try the northern bridge',
        kind: 'idea' as const,
        confidence: 1,
        occurredAt: Date.now(),
      };
      assert.ok(scoring.credit(moment));
      hub.publishMoment(moment);
      forecast.credit();
    }
    await overlay.waitForFunction(() =>
      document.getElementById('overlay')?.getAttribute('aria-label')?.includes('Chat forecast 3/3'),
    );
    clock += 600_001;
    await forecast.tick(true);
    await page.waitForSelector('#forecast-review button');
    await page.click('#forecast-review button');
    await page.waitForFunction(() =>
      document.getElementById('forecast-proposal')?.textContent?.includes('No, fewer'),
    );
    assert.equal(store.getMoments().length, 3);
    clock += 120_000;
    await forecast.tick(true);
    await page.waitForFunction(() =>
      document.getElementById('forecast-status')?.textContent?.includes('resolved'),
    );
    assert.equal(provider.predictions[0]?.winningOutcomeId, 'demo-outcome-1');
    assert.deepEqual(errors, []);
    assert.ok(
      await page.$eval('#entries-refunded', (element) => element.textContent?.includes('1')),
    );
    console.log(
      `FORECAST BROWSER PASS: port ${port} | fake native lifecycle + overlay 3/3 + correction 2/3 + auto resolution + four prize choices + refund counter; no Twitch calls`,
    );
  } finally {
    await browser?.close();
    await forecast.close();
    await app.close();
    store.close();
  }
}
