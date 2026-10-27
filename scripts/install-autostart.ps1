[CmdletBinding(DefaultParameterSetName = 'Install')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Install')][switch]$Install,
  [Parameter(Mandatory, ParameterSetName = 'Uninstall')][switch]$Uninstall,
  [Parameter(ParameterSetName = 'Install')][string]$NodePath = 'node'
)

# Owner-run only. Register for the current user; do not launch a server during installation.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'autostart-plan.ps1')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$privateDirectory = Join-Path $env:LOCALAPPDATA 'CreditsRoll'
$projectDirectory = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$powerShell = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
$toolDirectories = @()
if ($Install) {
  foreach ($tool in @('streamlink', 'ffmpeg')) {
    $command = Get-Command $tool -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $toolDirectories += Split-Path -Parent $command.Source }
  }
}
$plan = Get-CreditsRollTaskPlan -ProjectPath $projectDirectory -PrivatePath $privateDirectory -PowerShellPath $powerShell -UserId $identity.Name -Sid $identity.User.Value -ToolDirectories $toolDirectories
if ($Uninstall) {
  $task = Get-ScheduledTask -TaskName $plan.TaskName -TaskPath $plan.TaskPath -ErrorAction SilentlyContinue
  if ($task) {
    if ($task.Principal.UserId -notin @($identity.Name, $identity.User.Value)) { throw 'The existing task is not owned by this user.' }
    Unregister-ScheduledTask -TaskName $plan.TaskName -TaskPath $plan.TaskPath -Confirm:$false
  }
  Write-Output 'Credits Roll logon task removed. Existing server processes and private data were left alone.'
  return
}
if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'server\dist\index.js') -PathType Leaf)) {
  throw 'Copy the built server and overlay before installing autostart.'
}
$sourceNode = (Get-Command $NodePath -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
if ((& $sourceNode --version) -notmatch '^v22\.') { throw 'Select a Node 22 executable with -NodePath.' }
$runtimeDirectory = Split-Path -Parent $plan.NodePath
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
# Copy only the selected executable to a stable per-user path; no temporary download path enters the task.
if ([IO.Path]::GetFullPath($sourceNode) -ne [IO.Path]::GetFullPath($plan.NodePath)) {
  Copy-Item -LiteralPath $sourceNode -Destination $plan.NodePath -Force
}
if ((& $plan.NodePath --version) -notmatch '^v22\.') { throw 'The stable Node executable could not be verified.' }
$plan.Config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $plan.ConfigPath -Encoding UTF8
$action = New-ScheduledTaskAction -Execute $plan.Execute -Argument $plan.Argument -WorkingDirectory $plan.WorkingDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $plan.UserId
$principal = New-ScheduledTaskPrincipal -UserId $plan.UserId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$existing = Get-ScheduledTask -TaskName $plan.TaskName -TaskPath $plan.TaskPath -ErrorAction SilentlyContinue
if ($existing -and $existing.Principal.UserId -notin @($identity.Name, $identity.User.Value)) { throw 'The existing task is not owned by this user.' }
Register-ScheduledTask -TaskName $plan.TaskName -TaskPath $plan.TaskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start Credits Roll at user logon with its bounded restart supervisor.' -Force | Out-Null
Write-Output 'Credits Roll will start at your next logon. The installer did not start a server. Keep only one instance.'
Write-Output 'The task uses LOCALAPPDATA\CreditsRoll\runtime\node.exe and the private autostart.json launch settings.'
