import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';

// Node's fetch ignores a supplied Host header. Model the proxy hop with HTTP directly.
function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers, timeout: 2000 }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('error', reject);
      incoming.on('end', () =>
        resolve(
          new Response(Buffer.concat(chunks), {
            status: incoming.statusCode,
            headers: Object.fromEntries(
              Object.entries(incoming.headers).flatMap(([name, value]) =>
                value === undefined
                  ? []
                  : [[name, Array.isArray(value) ? value.join(', ') : value]],
              ),
            ),
          }),
        ),
      );
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Disposable HTTP check timed out')));
    request.end();
  });
}

const image = process.env.CONTAINER_IMAGE;
if (!image) throw new Error('Set CONTAINER_IMAGE to the self-host image tag to test');
const port = Number(process.env.PORT ?? 3101);
assert.ok([3101, 3102].includes(port), 'Use disposable test port 3101 or 3102');
const name = `credits-roll-smoke-${randomUUID()}`;
const directory = mkdtempSync(join(tmpdir(), 'credits-container-'));
const envPath = join(directory, 'synthetic.env');
const token = 'synthetic-container-overlay-token-32';
writeFileSync(
  envPath,
  [
    'PUBLIC_BASE_URL=https://credits.example',
    'CR_ALLOWED_TWITCH_USER_ID=123',
    'CR_SESSION_SECRET=synthetic-container-session-secret-32',
    `CR_OVERLAY_TOKEN=${token}`,
    'TWITCH_CLIENT_ID=synthetic-client',
    'TWITCH_CLIENT_SECRET=synthetic-secret',
    'CHAT_SOURCE=recorded',
    'JUDGE=fake',
  ].join('\n') + '\n',
  { mode: 0o600 },
);
function docker(args: string[], input?: string): string {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      input,
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`Disposable container check failed: docker ${args[0]}`);
  }
}
let created = false;
let volume = false;
try {
  docker(['volume', 'create', name]);
  volume = true;
  docker([
    'run',
    '--detach',
    '--name',
    name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--tmpfs',
    '/tmp:rw,nosuid,noexec,size=256m',
    '--mount',
    `source=${name},target=/data`,
    '--env-file',
    envPath,
    '-p',
    `127.0.0.1:${port}:3000`,
    image,
  ]);
  created = true;
  const headers = { host: 'credits.example', 'x-forwarded-proto': 'https' };
  const address = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await get(`${address}/health`)).ok;
    } catch {
      /* own container is starting */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Disposable container must become healthy');
  const health = await get(`${address}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(await health.json()).sort(), [
    'autoListen',
    'lastAudioAt',
    'lastChatAt',
    'listening',
    'mode',
    'status',
  ]);
  console.log('CONTAINER HTTP: /health 200 (private-IP Host, no auth, safe fields)');
  const login = await get(`${address}/auth/login`, headers);
  assert.equal(login.status, 302);
  assert.equal(new URL(login.headers.get('location')!).origin, 'https://id.twitch.tv');
  console.log('CONTAINER HTTP: /auth/login 302 -> Twitch (HTTPS callback derived)');
  assert.equal((await get(`${address}/dashboard/api/state`, headers)).status, 401);
  assert.equal((await get(`${address}/`, { ...headers, host: 'foreign.example' })).status, 403);
  for (const path of ['/overlay/', '/events', '/api/state', '/wheel'])
    assert.equal((await get(address + path, headers)).status, 404);
  const overlay = await get(`${address}/overlay/?token=${token}`, headers);
  assert.equal(overlay.status, 200);
  assert.ok((await overlay.text()).includes('?token='));
  assert.equal(overlay.headers.get('strict-transport-security'), 'max-age=31536000');
  console.log(
    'CONTAINER HTTP: dashboard 401; foreign Host 403; overlay/data without token 404; overlay with token 200; HSTS verified',
  );
  assert.equal(
    docker(['inspect', '--format', '{{.HostConfig.ReadonlyRootfs}} {{.Config.User}}', name]),
    'true node',
  );
  assert.equal(docker(['exec', name, 'id', '-u']), '1000');
  console.log('CONTAINER RUNTIME: read-only root; USER node (UID 1000); private /data volume');
  console.log(docker(['exec', name, 'streamlink', '--version']));
  console.log(docker(['exec', name, 'ffmpeg', '-version']).split('\n')[0]);
  console.log(
    docker(
      ['exec', '-i', '--workdir', '/app', name, 'node', '--input-type=module'],
      readFileSync(new URL('./container-auth-check.mjs', import.meta.url), 'utf8'),
    ),
  );
  const started = Date.now();
  docker(['stop', '--time', '25', name]);
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', name]), '0');
  assert.ok(Date.now() - started < 25_000);
  console.log(`CONTAINER SIGTERM: exit 0 in ${Date.now() - started} ms (<25000 ms)`);
  console.log('CONTAINER SMOKE PASS: no real Twitch/OpenAI calls; only disposable resources used');
} finally {
  if (created) docker(['rm', '--force', name]);
  if (volume) docker(['volume', 'rm', name]);
  rmSync(directory, { recursive: true, force: true });
}
