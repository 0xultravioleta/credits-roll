import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 3101);
assert.ok(port > 0 && port !== 3000, 'Use a test port other than 3000');
if (process.argv.includes('--blocked-child')) {
  const modulePath = process.argv.includes('--compiled')
    ? '../server/dist/runtime/watchdog.js'
    : '../server/src/runtime/watchdog.ts';
  const { startWatchdog } = await import(new URL(modulePath, import.meta.url).href);
  const server = createServer((_request, response) => {
    response.end('{"status":"ok"}');
  });
  server.listen(port, '127.0.0.1', () => {
    startWatchdog('http://127.0.0.1:' + port + '/health', console.error, {
      healthTimeoutMs: 1000,
      probeMs: 100,
      tickMs: 100,
    });
    // Only this disposable child is deliberately blocked. The worker must terminate it.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000);
    process.exit(2);
  });
} else {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(import.meta.url),
      '--blocked-child',
      ...(process.argv.includes('--compiled') ? ['--compiled'] : []),
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (bytes: Buffer) => {
    output += bytes.toString();
  });
  child.stderr.on('data', (bytes: Buffer) => {
    output += bytes.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.notEqual(code, 0);
  assert.notEqual(code, 2, 'The watchdog must terminate the child before its fallback exit');
  assert.ok(output.includes('WATCHDOG: /health has not answered'), output);
  console.log(
    'WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port ' +
      port,
  );
}
