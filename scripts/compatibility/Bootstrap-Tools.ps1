#requires -Version 7.2
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$tooling=Join-Path $repo '.test-runs/tooling'
$pkg=Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $tooling -Force | Out-Null
@{private=$true;packageManager=$pkg.packageManager;dependencies=$pkg.devDependencies} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $tooling 'package.json')
& npm.cmd --prefix $tooling install --no-audit --no-fund *> (Join-Path $tooling 'install.log')
if($LASTEXITCODE -ne 0){throw 'Build tooling installation failed; see .test-runs/tooling/install.log'}
$modules=Join-Path $repo 'node_modules'
if((Get-Item $modules -ErrorAction SilentlyContinue).LinkType){throw 'Repository node_modules points elsewhere; use a standalone checkout before bootstrap'}
foreach($name in @($pkg.devDependencies.PSObject.Properties.Name)){
  $source=Join-Path $tooling ("node_modules/$name")
  if(!(Test-Path $source)){Write-Warning "tooling does not contain $name; skipping junction"; continue}
  $destination=Join-Path $modules $name
  New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
  if(!(Test-Path $destination)){New-Item -ItemType Junction -Path $destination -Target $source | Out-Null}
}
Write-Output 'Tooling ready. Build with node scripts/clean-lib.mjs, .test-runs/tooling/node_modules/.bin/tsdown.cmd, then node scripts/verify-lib.mjs.'
