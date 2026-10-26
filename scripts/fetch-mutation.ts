import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Run in a throwaway checkout. Restore exact original bytes even on a failed assertion.
const source = new URL('../server/public/dashboard.js', import.meta.url);
const original = readFileSync(source);
const needle = 'this.fetcher = (...args) => Reflect.apply(fetcher, globalThis, args);';
assert.ok(original.toString('utf8').includes(needle), 'Receiver-safe implementation not found');
try {
  writeFileSync(source, original.toString('utf8').replace(needle, 'this.fetcher = fetcher;'));
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', 'server/src/dashboard/native-fetch.test.ts'],
    { encoding: 'utf8', windowsHide: true },
  );
  const output = result.stdout + result.stderr;
  assert.ok(
    result.status !== 0 &&
      output.includes('native fetch receiver stays undefined or globalThis') &&
      output.includes('AssertionError'),
    'Regression test did not reject the receiver mutation',
  );
  console.log('MUTATION KILLED: unbound native fetch regression fails (1 failed test).');
} finally {
  writeFileSync(source, original);
}
