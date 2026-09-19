#requires -Version 7.2
param([Parameter(Mandatory)][string]$Manifest)
$ErrorActionPreference='Stop'
$Manifest=(Resolve-Path $Manifest).Path
$r=Get-Content $Manifest -Raw | ConvertFrom-Json
$caseRoot=Split-Path $Manifest
& "$PSScriptRoot/Stop-Case.ps1" -Manifest $Manifest
$previousHome=$env:DSH_HOME
try{
  $env:DSH_HOME=$r.home
  & node $r.cli plugin --profile web remove dsh-wsl-workspace *> (Join-Path $caseRoot 'plugin-remove.log')
  if($LASTEXITCODE -ne 0){throw 'Plugin removal failed; inspect plugin-remove.log'}
  & "$PSScriptRoot/Start-Case.ps1" -Manifest $Manifest -WithoutPlugin
  $response=Invoke-WebRequest -Uri "http://127.0.0.1:$($r.port)/wsl-workspace/api" -Method Post -ContentType application/json -Body '{"method":"listDistros","params":{}}' -SkipHttpErrorCheck
  # Old web hosts route a missing POST through their static SPA handler (405),
  # while newer hosts return 404. With the plugin present this exact request
  # is a JSON Host API response (200), so either missing-route status proves
  # that its route has been removed.
  $pass=$response.StatusCode -in 404,405
  @{pass=$pass;status=[int]$response.StatusCode} | ConvertTo-Json | Set-Content (Join-Path $caseRoot 'uninstall.json')
  if(!$pass){throw "Expected removed route HTTP 404 or 405; got $($response.StatusCode)"}
  Write-Output 'PASS isolated uninstall and route removal'
}finally{
  $env:DSH_HOME=$previousHome
  & "$PSScriptRoot/Stop-Case.ps1" -Manifest $Manifest
}
