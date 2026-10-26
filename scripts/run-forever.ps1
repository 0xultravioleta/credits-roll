param(
  [string]$NodePath = 'node',
  [switch]$NoRun
)

function Test-RestartBudget {
  param([datetime[]]$History, [datetime]$Now)
  $recent = @($History | Where-Object { $_ -gt $Now.AddMinutes(-10) })
  return $recent.Count -lt 5
}

function Test-OperatorStop {
  param([long]$ExitCode)
  return $ExitCode -in @(130, -1073741510, 3221225786)
}

if ($NoRun) { return }
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
$restartHistory = @()
while ($true) {
  & $NodePath --env-file-if-exists=.env server/dist/index.js
  $result = $LASTEXITCODE
  if ($result -eq 0) { exit 0 }
  # Ctrl+C is an operator stop, even if the native process reports a non-zero interrupt code.
  if (Test-OperatorStop -ExitCode $result) { exit $result }
  $now = [datetime]::UtcNow
  $restartHistory = @($restartHistory | Where-Object { $_ -gt $now.AddMinutes(-10) })
  if (-not (Test-RestartBudget -History $restartHistory -Now $now)) {
    Write-Error 'WATCHDOG: restart limit reached (5 restarts per 10 minutes). Review the local status log.'
    exit 1
  }
  $restartHistory += $now
  Write-Output "WATCHDOG: server exited with code $result. Restarting ($($restartHistory.Count)/5 in 10 minutes)."
  Start-Sleep -Seconds 1
}
