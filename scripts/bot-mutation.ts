import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const path = new URL('../server/src/pipeline.ts', import.meta.url);
const original = readFileSync(path);
const needle = 'if (this.botFilter.ignores(message)) return;';
assert.ok(original.toString('utf8').includes(needle));
try {
  writeFileSync(path, original.toString('utf8').replace(needle, 'if (false) return;'));
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', 'server/src/twitch/bot-filter.test.ts'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.ok(
    result.status !== 0 && (result.stdout + result.stderr).includes('AssertionError'),
    'Bot-filter mutation survived',
  );
  console.log('MUTATION KILLED: bypassing the bot filter fails the service-account fixtures.');
} finally {
  writeFileSync(path, original);
}
