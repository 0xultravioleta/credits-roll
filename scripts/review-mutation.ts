import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Run only in a throwaway checkout. Each negative control restores exact bytes.
const guards = [
  [
    'success streak reset',
    'server/src/live/runtime.ts',
    'server/src/live/review-recovery.test.ts',
    'onProviderSuccess: () => {\n            this.providerState.consecutive = 0;',
    'onProviderSuccess: () => {',
  ],
  [
    'session-start streak reset',
    'server/src/live/runtime.ts',
    'server/src/live/review-recovery.test.ts',
    'onStart: async (signal) => {\n        this.languageRevision++;\n        this.providerState.consecutive = 0;',
    'onStart: async (signal) => {\n        this.languageRevision++;',
  ],
  [
    'session provider message',
    'server/src/live/session.ts',
    'server/src/live/session.test.ts',
    '? error.message',
    "? 'Generic stopped status'",
  ],
  [
    'minute interval',
    'server/src/live/counters.ts',
    'server/src/live/counters.test.ts',
    'COUNTER_INTERVAL_MS = 60_000',
    'COUNTER_INTERVAL_MS = 1000',
  ],
  [
    'duplicate credit counter',
    'server/src/pipeline.ts',
    'server/src/live/counters.test.ts',
    "if (this.options.scoring.credit(moment)) {\n          this.options.counters?.increment('kept');",
    "this.options.counters?.increment('kept');\n        if (this.options.scoring.credit(moment)) {",
  ],
  [
    'recorded language validation',
    'server/src/transcript/recorded.ts',
    'server/src/transcript/transcript.test.ts',
    "(row.language !== undefined &&\n        (typeof row.language !== 'string' || !/^[a-z]{2}$/.test(row.language))) ||",
    '',
  ],
  [
    'counter language sanitization',
    'server/src/live/counters.ts',
    'server/src/live/counters.test.ts',
    "languageCode(this.language()) ?? 'en'",
    'this.language()',
  ],
  [
    'entry-point counter start',
    'server/src/index.ts',
    'server/src/index.test.ts',
    '  counters.start();',
    '',
  ],
  [
    'entry-point language environment',
    'server/src/index.ts',
    'server/src/index.test.ts',
    'transcriptionLanguage: env.CR_TRANSCRIPTION_LANGUAGE,',
    'transcriptionLanguage: undefined,',
  ],
  [
    'generic-agreement guard',
    'server/src/matcher/openai-judge.ts',
    'server/src/ai/ai.test.ts',
    'Those phrases alone, generic agreement or topical overlap are insufficient.',
    '',
  ],
  [
    'Spanish-refusal guard',
    'server/src/matcher/openai-judge.ts',
    'server/src/ai/ai.test.ts',
    'Reject Spanish refusals such as "no voy a hacerlo" just as you reject English refusals.',
    '',
  ],
] as const;
for (const [name, path, test, needle, replacement] of guards) {
  const original = readFileSync(path);
  const source = original.toString('utf8').replace(/\r\n/g, '\n');
  assert.ok(source.includes(needle), `Guard implementation missing: ${name}`);
  try {
    writeFileSync(path, source.replace(needle, replacement));
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', test], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    });
    const output = result.stdout + result.stderr;
    assert.ok(
      result.status !== 0 && output.includes('AssertionError'),
      `Mutation survived or failed without a behavioral assertion: ${name}`,
    );
    console.log(`MUTATION KILLED: ${name}`);
  } finally {
    writeFileSync(path, original);
  }
}
console.log(
  `REVIEW MUTATIONS: ${guards.length}/${guards.length} killed; exact source bytes restored.`,
);
