#requires -Version 7.2
param([Parameter(Mandatory)][string]$Manifest)
$ErrorActionPreference='Stop'
$r=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
if(!$r.pid){return}
$process=Get-CimInstance Win32_Process -Filter "ProcessId=$($r.pid)"
if(!$process){
  $r.pid=$null
  $r | ConvertTo-Json | Set-Content -LiteralPath $Manifest
  Write-Output 'Already stopped (cleared stale PID)'
  return
}
$portPattern='--port\s+'+[regex]::Escape([string]$r.port)+'\b'
if($process.Name -ne 'node.exe' -or !$process.CommandLine.Contains($r.cli) -or $process.CommandLine -notmatch $portPattern){throw 'PID has been reused or command does not match this case; nothing stopped'}
$live=Get-Process -Id $r.pid
if($r.processStartedAt -and $live.StartTime.ToUniversalTime().Ticks -ne ([datetime]$r.processStartedAt).ToUniversalTime().Ticks){throw 'PID start time differs; nothing stopped'}
Stop-Process -Id $r.pid
$r.pid=$null
$r | ConvertTo-Json | Set-Content -LiteralPath $Manifest
Write-Output 'Stopped this test case'
