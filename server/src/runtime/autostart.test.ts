import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';

test.runIf(process.platform === 'win32')(
  'PowerShell parses the installer without executing it; pure plan pins stable Node and safely quotes a private path',
  () => {
    const scripts = fileURLToPath(new URL('../../../scripts/', import.meta.url));
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(${quote(scripts + 'install-autostart.ps1')}, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'Installer parse failed' }
    . ${quote(scripts + 'autostart-plan.ps1')}
    Get-CreditsRollTaskPlan -ProjectPath 'C:\\Projects\\Credits Roll' -PrivatePath "C:\\Users\\O'Brien\\AppData\\Local\\CreditsRoll" -PowerShellPath 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -UserId 'synthetic-user' -Sid 'S-1-5-21-synthetic' -ToolDirectories @('C:\\Tools\\ffmpeg') | ConvertTo-Json -Depth 4 -Compress
  `,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    expect(plan.NodePath).toContain('AppData\\Local\\CreditsRoll\\runtime\\node.exe');
    expect(plan.TaskName).toBe('Credits Roll-S-1-5-21-synthetic');
    expect(plan.Argument).toContain('-WindowStyle Hidden');
    const encoded = plan.Argument.split(' ').at(-1)!;
    const launch = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(launch).toContain("O''Brien");
    expect(launch).toContain('run-forever.ps1');
    expect(launch).toContain('config.nodePath');
    expect(launch).not.toContain('Start-ScheduledTask');
  },
);
test('installer never starts or stops a task, and the bounded supervisor saves its exhausted-budget alert', () => {
  const installer = readFileSync(
    new URL('../../../scripts/install-autostart.ps1', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  expect(installer).toContain('-AtLogOn -User');
  expect(installer).toContain('-LogonType Interactive -RunLevel Limited');
  expect(installer).toContain('-MultipleInstances IgnoreNew');
  expect(installer).not.toMatch(/\b(?:Start|Stop)-ScheduledTask\b/);
  const supervisor = readFileSync(
    new URL('../../../scripts/run-forever.ps1', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  expect(supervisor).toContain('supervisor-alert-cli.js --restart-limit');
});
