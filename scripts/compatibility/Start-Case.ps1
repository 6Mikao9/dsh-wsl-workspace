#requires -Version 7.2
param([Parameter(Mandatory)][string]$Manifest,[switch]$WithoutPlugin)
$ErrorActionPreference='Stop'
$Manifest=(Resolve-Path -LiteralPath $Manifest).Path
$caseRoot=Split-Path $Manifest
$r=Get-Content $Manifest -Raw | ConvertFrom-Json
if($r.port -lt 3200 -or $r.port -gt 3399){throw 'Test port must be 3200-3399'}
if(Get-NetTCPConnection -LocalPort $r.port -State Listen -ErrorAction SilentlyContinue){throw "Port $($r.port) is already in use; stop the owning test case first"}
$previousHome=$env:DSH_HOME
try{
  $env:DSH_HOME=$r.home
  # All versions accept this form; early versions reject --no-open.
  $process=Start-Process -FilePath (Get-Command node).Source -ArgumentList ('"'+$r.cli+'"'),'web','--port',$r.port -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $caseRoot 'web.log') -RedirectStandardError (Join-Path $caseRoot 'web.err')
  $r.pid=$process.Id
  $r | Add-Member -NotePropertyName processStartedAt -NotePropertyValue $process.StartTime.ToUniversalTime().ToString('o') -Force
  $r | ConvertTo-Json | Set-Content $Manifest
}finally{$env:DSH_HOME=$previousHome}
for($attempt=0;$attempt -lt 60;$attempt++){
  if(!(Get-Process -Id $r.pid -ErrorAction SilentlyContinue)){throw 'Server exited; read web.err/web.log'}
  try{
    if($WithoutPlugin){
      # A profile without the web plugin may require its browser token for
      # HTTP routes. A listening TCP socket is sufficient for the subsequent
      # explicit missing-route assertion in Check-Uninstall.
      $socket=[Net.Sockets.TcpClient]::new()
      try {
        $socket.Connect('127.0.0.1',$r.port)
        if($socket.Connected){Write-Output "READY without plugin port=$($r.port) pid=$($r.pid)";exit 0}
      } finally {$socket.Dispose()}
    }
    $answer=Invoke-RestMethod -Uri "http://127.0.0.1:$($r.port)/wsl-workspace/api" -Method Post -ContentType application/json -Body '{"method":"listDistros","params":{}}' -TimeoutSec 2
    if(!$WithoutPlugin -and $answer.ok){Write-Output "READY port=$($r.port) pid=$($r.pid)";exit 0}
  }catch{}
  Start-Sleep -Milliseconds 500
}
throw 'Server did not become ready; inspect logs and WSL permissions. The PID remains in runtime.json for Stop-Case.'
