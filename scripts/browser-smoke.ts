import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createApp } from '../server/src/app.js';
import { Store } from '../server/src/store/index.js';
import { FileCreditLedger } from '../server/src/ledger/index.js';

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
  const { app, scoring } = createApp({
    store,
    ledger: new FileCreditLedger(join(directory, 'credits-ledger.jsonl'), process.cwd()),
    environment: () => ({
      liveEnabled: true,
      apiKeyPresent: true,
      tools: { streamlink: true, ffmpeg: true },
      listening,
    }),
    actions: {
      stop: async () => {
        listening = false;
      },
    },
  });
  scoring.credit({
    id: 'browser-credit',
    messageId: 'browser-chat',
    streamId: 'synthetic-stream',
    viewer: { id: 'synthetic-viewer', login: 'syntheticviewer' },
    kind: 'idea',
    confidence: 1,
    occurredAt: Date.now(),
    quote: 'Try the northern bridge',
    adoptionExcerpt: 'Good idea, trying the northern bridge.',
  });
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
    unlinkSync(join(directory, 'credits.csv'));
    store.optOut('synthetic-viewer');
    await page.click('#download-credits');
    await page.waitForFunction(() =>
      document.getElementById('ledger-totals')?.textContent?.includes('0 credits given'),
    );
    for (let attempt = 0; attempt < 30 && !existsSync(join(directory, 'credits.csv')); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(!readFileSync(join(directory, 'credits.csv'), 'utf8').includes('syntheticviewer'));
    assert.deepEqual(errors, []);
    console.log(
      `BROWSER SMOKE PASS: ${await browser.version()} | port ${port} | state requested | checklist loaded | Stop + inline 409 + practice + ledger filters + CSV + privacy verified`,
    );
  } finally {
    await browser?.close();
    await app.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
}
