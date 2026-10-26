import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

test.skipIf(process.platform !== 'win32')(
  'PowerShell supervisor admits five restarts per ten minutes and preserves operator stops',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'credits-supervisor-'));
    try {
      const script = join(directory, 'check.ps1');
      writeFileSync(
        script,
        `param([string]$Supervisor)\n. $Supervisor -NoRun\n$now = [datetime]'2026-10-26T12:00:00Z'\n$history = @(1..5 | ForEach-Object { $now.AddSeconds(-$_) })\nTest-RestartBudget -History @() -Now $now\nTest-RestartBudget -History $history -Now $now\nTest-RestartBudget -History $history -Now $now.AddMinutes(10)\nTest-OperatorStop -ExitCode 130\nTest-OperatorStop -ExitCode -1073741510\nTest-OperatorStop -ExitCode 1\n`,
      );
      const output = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-File', script, resolve('scripts/run-forever.ps1')],
        { encoding: 'utf8', windowsHide: true },
      );
      expect(output.replace(/\r\n/g, '\n').trim().split('\n')).toEqual([
        'True',
        'False',
        'True',
        'True',
        'True',
        'False',
      ]);
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
);
