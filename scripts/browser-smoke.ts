import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createApp } from '../server/src/app.js';
import { Store } from '../server/src/store/index.js';
import { FileCreditLedger } from '../server/src/ledger/index.js';
import { FileDebugLog } from '../server/src/debug/log.js';
import { Pipeline } from '../server/src/pipeline.js';
import { Matcher } from '../server/src/matcher/index.js';
import { createProviders } from '../server/src/ai/providers.js';
import type { Moment } from '../server/src/domain.js';

const executablePath = process.env.BROWSER_PATH;
if (!executablePath || !existsSync(executablePath)) {
  console.log('SKIP browser smoke: set BROWSER_PATH to an installed Edge or Chrome executable.');
} else {
  const port = Number(process.env.PORT ?? 3101);
  assert.ok(
    Number.isInteger(port) && port > 0 && port !== 3000,
    'Choose a test port other than 3000',
  );
  const directory = mkdtempSync(join(tmpdir(), 'credits-browser-smoke-'));
  const store = new Store();
  let listening = true;
  const { app, scoring, debug, botFilter, hub, dashboard, ledger } = createApp({
    store,
    ledger: new FileCreditLedger(join(directory, 'credits-ledger.jsonl'), process.cwd()),
    debug: new FileDebugLog(join(directory, 'debug-log.jsonl'), process.cwd()),
    environment: () => ({
      liveEnabled: true,
      apiKeyPresent: true,
      tools: { streamlink: true, ffmpeg: true },
      listening,
      broadcasterType: '',
      status: {
        autoListen: true,
        listening,
        phase: listening ? 'listening' : 'not-listening',
        reason: listening ? 'Receiving synthetic stream audio.' : 'Stopped by you for this stream.',
        lastAudioAt: listening ? Date.now() - 4000 : null,
        lastChatAt: null,
        retry: 0,
      },
    }),
    actions: {
      stop: async () => {
        listening = false;
      },
    },
  });
  const providers = createProviders({});
  const pipeline = new Pipeline({
    store,
    hub,
    scoring,
    debug,
    botFilter,
    matcher: new Matcher(providers.judge, providers.embeddings),
    transcriber: providers.transcriber,
  });
  pipeline.addChat({
    id: 'bot-chat',
    viewer: { id: 'bot-id', login: 'Nightbot' },
    text: 'Synthetic service output',
    sentAt: Date.now(),
  });
  const browserMoment: Moment = {
    id: 'browser-credit',
    messageId: 'browser-chat',
    streamId: 'synthetic-stream',
    viewer: { id: 'synthetic-viewer', login: 'syntheticviewer' },
    kind: 'idea',
    confidence: 1,
    occurredAt: Date.now(),
    quote: 'Try the northern bridge',
    adoptionExcerpt: 'Good idea, trying the northern bridge.',
  };
  scoring.credit(browserMoment);
  hub.beginStream(browserMoment.streamId);
  hub.publishMoment(browserMoment);
  let browser;
  try {
    const address = await app.listen({ host: '127.0.0.1', port });
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-first-run', '--disable-background-networking'],
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    let stateRequests = 0;
    let ledgerRequests = 0;
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== address) {
        void request.abort();
        return;
      }
      if (url.pathname === '/dashboard/api/state') stateRequests++;
      if (url.pathname === '/dashboard/api/ledger') ledgerRequests++;
      void request.continue();
    });
    await page.goto(`${address}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const badges = [...document.querySelectorAll('.checklist .badge')];
        return (
          badges.length === 4 && badges.every((badge) => !badge.textContent?.includes('Checking'))
        );
      },
      { timeout: 10_000 },
    );
    assert.ok(stateRequests > 0, 'Dashboard must request /dashboard/api/state');
    assert.equal(
      await page.$eval('#clip-each', (element) => (element as HTMLInputElement).checked),
      true,
    );
    assert.ok(
      await page.$eval('#clip-status', (element) =>
        element.textContent?.includes('Markers need VOD storage'),
      ),
    );
    const overlayPage = await browser.newPage();
    overlayPage.on('pageerror', (error) => errors.push(String(error)));
    await overlayPage.setRequestInterception(true);
    overlayPage.on('request', (request) => {
      if (new URL(request.url()).origin === address) void request.continue();
      else void request.abort();
    });
    await overlayPage.goto(address + '/overlay/?preview=1', { waitUntil: 'domcontentloaded' });
    await overlayPage.waitForFunction(() =>
      document.getElementById('announcement')?.textContent?.includes('moved the stream'),
    );
    const media = {
      clip: {
        status: 'ready' as const,
        id: 'demo-browser',
        url: '/demo/clip/demo-browser',
        thumbnailUrl: '/demo/clip-thumbnail.svg',
        demo: true,
      },
      marker: { status: 'ready' as const, id: 'demo-marker', positionSeconds: 42 },
    };
    ledger.updateMedia(browserMoment.id, media);
    hub.publishClip({ ...browserMoment, media });
    await overlayPage.waitForFunction(() =>
      document.getElementById('announcement')?.textContent?.includes('Clipped'),
    );
    await page.waitForSelector('#credited-rows a[href="/demo/clip/demo-browser"]');
    hub.rollCredits(browserMoment.streamId);
    await overlayPage.waitForFunction(() =>
      performance
        .getEntriesByType('resource')
        .some((entry) => entry.name.endsWith('/demo/clip-thumbnail.svg')),
    );
    await overlayPage.close();
    assert.ok(
      await page.$eval('#listening-status', (element) =>
        element.textContent?.includes('*** Listening'),
      ),
    );
    assert.equal(await page.$$eval('#go-live-checklist li', (elements) => elements.length), 5);
    assert.ok(
      await page.$eval('#go-live-permissions', (element) =>
        element.textContent?.includes('Reconnect streamer to enable clips'),
      ),
    );
    assert.equal(
      await page.$eval('#wheel-option', (element) => (element as HTMLElement).hidden),
      true,
    );
    assert.equal(
      await page.$eval('#live-spin', (element) => (element as HTMLElement).hidden),
      true,
    );
    assert.equal(
      await page.$eval('#auto-listen', (element) => (element as HTMLInputElement).checked),
      true,
    );
    const savedBadges = await page.$$eval('.checklist .badge', (elements) =>
      elements.map((element) => element.textContent),
    );
    await page.setOfflineMode(true);
    await page.waitForFunction(() =>
      document
        .getElementById('listening-status')
        ?.textContent?.includes('Last known: *** Listening'),
    );
    assert.deepEqual(
      await page.$$eval('.checklist .badge', (elements) =>
        elements.map((element) => element.textContent),
      ),
      savedBadges,
    );
    await page.setOfflineMode(false);
    await page.waitForFunction(
      () => (document.getElementById('reconnecting') as HTMLElement).hidden,
    );
    assert.equal(
      await page.$eval('#reconnecting', (element) => (element as HTMLElement).hidden),
      true,
    );
    await page.waitForSelector('#listening-banner:not([hidden])');
    await page.click('#start-listening');
    await page.waitForFunction(() =>
      document
        .querySelector('#start-listening + .action-message')
        ?.textContent?.includes('Already listening'),
    );
    await page.click('#listening-banner button');
    await page.waitForFunction(
      () => (document.getElementById('listening-banner') as HTMLElement).hidden,
    );
    await page.click('button[data-action="practice/speech"]');
    await page.waitForFunction(() =>
      document
        .querySelector('button[data-action="practice/speech"] + .action-message')
        ?.textContent?.includes('viewer message first'),
    );
    await page.click('button[data-action="practice/chat"]');
    await page.waitForFunction(() =>
      document.getElementById('activity')?.textContent?.includes('Chat: @mapmaker'),
    );
    await page.click('button[data-action="practice/speech"]');
    await page.waitForFunction(() => document.getElementById('moments')?.textContent === '1');
    assert.equal(await page.$eval('#viewers', (element) => element.textContent), '1');
    assert.ok(
      await page.$eval('#debug-status', (element) =>
        element.textContent?.includes('Ignored bots: 1'),
      ),
    );
    assert.equal(await page.$eval('#confidence-value', (element) => element.textContent), '0.70');
    assert.ok(
      await page.$eval('#matching-explanation', (element) =>
        element.textContent?.includes('After-reply candidates are OFF'),
      ),
    );
    await page.$eval('#confidence', (element) => {
      (element as HTMLInputElement).value = '0.65';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('#lookback', (element) => {
      (element as HTMLInputElement).value = '120';
    });
    await page.$eval('#ignored-logins', (element) => {
      (element as HTMLInputElement).value += ', syntheticservice';
    });
    await page.click('#settings button[type="submit"]');
    await page.waitForFunction(() =>
      document
        .getElementById('matching-explanation')
        ?.textContent?.includes('Saved confidence threshold: 0.65'),
    );
    assert.equal(dashboard.getSettings().lookbackSeconds, 120);
    assert.ok(botFilter.ignoredLogins().includes('syntheticservice'));
    await page.waitForSelector('#credited-rows tr');
    assert.ok(
      await page.$eval('#credited-rows', (element) =>
        element.textContent?.includes('syntheticviewer'),
      ),
    );
    await page.type('#ledger-viewer', 'nobody');
    assert.equal(await page.$$eval('#credited-rows tr', (rows) => rows.length), 0);
    await page.$eval('#ledger-viewer', (element) => {
      (element as HTMLInputElement).value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const session = await page.createCDPSession();
    await session.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: directory,
    });
    const previousRequests = ledgerRequests;
    await page.click('#download-credits');
    await page.waitForFunction(() =>
      document.getElementById('ledger-message')?.textContent?.includes('downloaded as CSV'),
    );
    for (let attempt = 0; attempt < 30 && !existsSync(join(directory, 'credits.csv')); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(ledgerRequests > previousRequests, 'Export must reread the authoritative ledger');
    assert.ok(readFileSync(join(directory, 'credits.csv'), 'utf8').includes('syntheticviewer'));
    assert.ok(readFileSync(join(directory, 'credits.csv'), 'utf8').includes('Clip,VOD marker'));
    assert.ok(
      readFileSync(join(directory, 'credits.csv'), 'utf8').includes('/demo/clip/demo-browser'),
    );
    unlinkSync(join(directory, 'credits.csv'));
    store.optOut('synthetic-viewer');
    await page.click('#download-credits');
    await page.waitForFunction(() =>
      document.getElementById('ledger-totals')?.textContent?.includes('0 credits given'),
    );
    for (let attempt = 0; attempt < 30 && !existsSync(join(directory, 'credits.csv')); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(!readFileSync(join(directory, 'credits.csv'), 'utf8').includes('syntheticviewer'));
    assert.ok(!readFileSync(join(directory, 'credits.csv'), 'utf8').includes('demo-browser'));
    await page.click('#download-debug');
    for (
      let attempt = 0;
      attempt < 50 && !existsSync(join(directory, 'credits-debug.jsonl'));
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    const diagnostic = readFileSync(join(directory, 'credits-debug.jsonl'), 'utf8');
    assert.ok(diagnostic.includes('ignored-bot') && diagnostic.includes('"type":"judge"'));
    await page.click('button[data-action="debug/clear"]');
    await page.waitForFunction(() =>
      document.getElementById('debug-status')?.textContent?.includes('Bytes: 0'),
    );
    assert.equal(debug.snapshot(), '');
    assert.deepEqual(errors, []);
    console.log(
      `BROWSER SMOKE PASS: ${await browser.version()} | port ${port} | Clipped popup + local credits thumbnail + clip/marker CSV + privacy + native fetch + go-live checklist + reconnect + Stop + practice + matching + debug verified`,
    );
  } finally {
    await browser?.close();
    pipeline.close();
    await app.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
}
