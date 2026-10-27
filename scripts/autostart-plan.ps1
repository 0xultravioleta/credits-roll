# Pure task planning. Loading this file never registers, starts or stops a task.
function Get-CreditsRollTaskPlan {
  param(
    [Parameter(Mandatory)][string]$ProjectPath,
    [Parameter(Mandatory)][string]$PrivatePath,
    [Parameter(Mandatory)][string]$PowerShellPath,
    [Parameter(Mandatory)][string]$UserId,
    [Parameter(Mandatory)][string]$Sid,
    [string[]]$ToolDirectories = @()
  )
  $stableNode = Join-Path $PrivatePath 'runtime\node.exe'
  $configPath = Join-Path $PrivatePath 'autostart.json'
  $escapedConfigPath = $configPath.Replace("'", "''")
  $launch = @"
`$ErrorActionPreference = 'Stop'
`$config = Get-Content -LiteralPath '$escapedConfigPath' -Raw | ConvertFrom-Json
`$env:Path = ((@((Split-Path -Parent `$config.nodePath)) + @(`$config.toolDirectories) + @(`$env:Path)) -join ';')
Set-Location -LiteralPath `$config.projectPath
& (Join-Path `$config.projectPath 'scripts\run-forever.ps1') -NodePath `$config.nodePath
exit `$LASTEXITCODE
"@
  return [pscustomobject]@{
    TaskName = "Credits Roll-$Sid"
    TaskPath = '\'
    UserId = $UserId
    Execute = $PowerShellPath
    Argument = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launch))
    WorkingDirectory = $ProjectPath
    ConfigPath = $configPath
    NodePath = $stableNode
    Config = [ordered]@{ projectPath = $ProjectPath; nodePath = $stableNode; toolDirectories = @($ToolDirectories) }
  }
}
