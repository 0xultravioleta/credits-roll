import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { createApp } from '../server/src/app.js';
import { Store } from '../server/src/store/index.js';
import { hostedConfig } from '../server/src/hosting/config.js';
import { HostedSecurity } from '../server/src/hosting/security.js';

/** Local HTTP models the private hop behind TLS termination; no external calls. */
export async function hostedBrowserSmoke(executablePath: string, port: number): Promise<void> {
  assert.ok(port !== 3000);
  const hosting = hostedConfig({
    PUBLIC_BASE_URL: `https://localhost:${port}`,
    CR_ALLOWED_TWITCH_USER_ID: '123',
    CR_SESSION_SECRET: 'synthetic-browser-session-secret-32',
    CR_OVERLAY_TOKEN: 'synthetic-browser-overlay-token-32',
  })!;
  const store = new Store();
  const { app, hub, scoring } = createApp({ store, hosting });
  const moment = {
    id: 'hosted-browser-moment',
    messageId: 'hosted-browser-chat',
    streamId: 'hosted-synthetic',
    viewer: { id: 'synthetic-viewer', login: 'syntheticviewer' },
    quote: 'Try the northern bridge',
    kind: 'idea' as const,
    confidence: 1,
    occurredAt: Date.now(),
  };
  scoring.credit(moment);
  hub.beginStream(moment.streamId);
  hub.publishMoment(moment);
  let browser;
  try {
    await app.listen({ host: '127.0.0.1', port });
    const address = `http://localhost:${port}`;
    const anonymous = await fetch(`${address}/dashboard/api/state`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.equal(anonymous.status, 401);
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-first-run', '--disable-background-networking'],
    });
    const session = new HostedSecurity(hosting).sessionCookie().split(';')[0]!;
    const split = session.indexOf('=');
    await browser.setCookie({
      name: session.slice(0, split),
      value: session.slice(split + 1),
      domain: 'localhost',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });
    const errors: string[] = [];
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'x-forwarded-proto': 'https' });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin === address) void request.continue();
      else void request.abort();
    });
    page.on('pageerror', (error) => errors.push(String(error)));
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
    const overlayUrl = await page.$eval(
      '#overlay-url',
      (element) => (element as HTMLInputElement).value,
    );
    assert.equal(new URL(overlayUrl).searchParams.get('token'), hosting.overlayToken);
    const previewUrl = await page.$eval(
      'a[data-overlay-link]',
      (element) => (element as HTMLAnchorElement).href,
    );
    assert.equal(new URL(previewUrl).searchParams.get('token'), hosting.overlayToken);
    const overlay = await browser.newPage();
    await overlay.setExtraHTTPHeaders({ 'x-forwarded-proto': 'https' });
    await overlay.setRequestInterception(true);
    let events = 0;
    let assets = 0;
    overlay.on('pageerror', (error) => errors.push(String(error)));
    overlay.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== address) {
        void request.abort();
        return;
      }
      if (url.pathname === '/events' || url.pathname.startsWith('/overlay/assets/')) {
        assert.equal(url.searchParams.get('token'), hosting.overlayToken);
        if (url.pathname === '/events') events++;
        else assets++;
      }
      void request.continue();
    });
    await overlay.goto(
      `${address}/overlay/?token=${encodeURIComponent(hosting.overlayToken)}&preview=1`,
      { waitUntil: 'domcontentloaded' },
    );
    await overlay.waitForFunction(
      () => document.getElementById('announcement')?.textContent?.includes('moved the stream'),
      { timeout: 10_000 },
    );
    assert.ok(events > 0 && assets >= 2);
    assert.deepEqual(errors, []);
    console.log(
      `HOSTED BROWSER PASS: port ${port} | signed session + protected state + copyable private URL + tokenized assets/SSE + real popup`,
    );
  } finally {
    await browser?.close();
    await app.close();
    store.close();
  }
}
