import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createApp } from '../server/src/app.js';
import { Store } from '../server/src/store/index.js';

const executablePath = process.env.BROWSER_PATH;
if (!executablePath || !existsSync(executablePath)) {
  console.log('SKIP browser smoke: set BROWSER_PATH to an installed Edge or Chrome executable.');
} else {
  const port = Number(process.env.PORT ?? 3101);
  assert.ok(
    Number.isInteger(port) && port > 0 && port !== 3000,
    'Choose a test port other than 3000',
  );
  const store = new Store();
  const { app } = createApp({ store });
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
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== address) {
        void request.abort();
        return;
      }
      if (url.pathname === '/dashboard/api/state') stateRequests++;
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
    assert.deepEqual(errors, []);
    console.log(
      `BROWSER SMOKE PASS: ${await browser.version()} | port ${port} | state requested | checklist loaded`,
    );
  } finally {
    await browser?.close();
    await app.close();
    store.close();
  }
}
