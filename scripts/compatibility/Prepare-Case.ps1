#requires -Version 7.2
param(
  [Parameter(Mandatory)][string]$Version,
  [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [string]$RuntimeRoot,
  [ValidateRange(3200,3399)][int]$Port = 3290
)
$ErrorActionPreference='Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$versions = Get-Content (Join-Path $PSScriptRoot 'versions.json') -Raw | ConvertFrom-Json
if($Version -notin $versions.versions){throw "Version is outside the approved matrix: $Version"}
if($RunId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$'){throw 'RunId must be a simple directory name'}
$caseRoot=Join-Path $repo ".test-runs/runs/$RunId/$Version"
if(Test-Path $caseRoot){throw "Case already exists; use a new RunId to preserve evidence: $caseRoot"}
New-Item -ItemType Directory -Path $caseRoot -Force | Out-Null
if(!$RuntimeRoot){
  $RuntimeRoot=Join-Path $repo ".test-runs/runtimes/$Version"
  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  # Do not inherit a global pnpm store. Some desktop/sandbox configurations
  # point it at an unreadable SQLite database; this shared test-only store is
  # writable and does not touch the user's normal DSH installation.
  $storeRoot=Join-Path $repo '.test-runs/pnpm-store'
  New-Item -ItemType Directory -Path $storeRoot -Force | Out-Null
  $runtimePackage=[ordered]@{name='dsh-compat-runtime'; version='0.0.0'; private=$true}
  $runtimePackage | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $RuntimeRoot 'package.json')
  @"
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': true
  fs-ext: true
  koffi: true
  node-pty: true
  protobufjs: true
"@ | Set-Content (Join-Path $RuntimeRoot 'pnpm-workspace.yaml')
  $family=($Version -split '-')[0]+'-'
  $hook=@'
module.exports={hooks:{readPackage(pkg){for(const group of ['dependencies','optionalDependencies','peerDependencies'])for(const [name,version] of Object.entries(pkg[group]||{}))if(name.startsWith('@deepseek-ai/dsh')&&typeof version==='string'&&version.includes('FAMILY'))pkg[group][name]='VERSION';return pkg;}}};
'@
  $hook.Replace('FAMILY',$family).Replace('VERSION',$Version) | Set-Content (Join-Path $RuntimeRoot '.pnpmfile.cjs')
  # pnpm 11 rejects a successful install when lifecycle scripts are merely
  # pending approval. These are runtime dependencies required by the isolated
  # DSH host; keep the allow-list explicit so arbitrary package scripts remain
  # disabled during compatibility preparation.
  $installLog=Join-Path $caseRoot 'runtime-install.log'
  & pnpm.cmd --dir $RuntimeRoot --store-dir $storeRoot --force add "@deepseek-ai/dsh@$Version" *> $installLog
  if($LASTEXITCODE -ne 0 -and (Select-String -LiteralPath $installLog -Pattern 'ERR_PNPM_IGNORED_BUILDS' -Quiet)){
    # pnpm 11 requires an explicit, non-interactive approval in fresh stores.
    & pnpm.cmd --dir $RuntimeRoot --store-dir $storeRoot approve-builds --all *> $installLog
    & pnpm.cmd --dir $RuntimeRoot --store-dir $storeRoot install --force *> $installLog
  }
  if($LASTEXITCODE -ne 0){throw "Runtime installation failed; see $caseRoot/runtime-install.log"}
}
$RuntimeRoot=(Resolve-Path -LiteralPath $RuntimeRoot).Path
$cli=Join-Path $RuntimeRoot 'node_modules/@deepseek-ai/dsh/lib/bin.js'
if(!(Test-Path $cli)){throw "Missing CLI: $cli"}
$cliPackage=Get-Content (Join-Path $RuntimeRoot 'node_modules/@deepseek-ai/dsh/package.json') -Raw | ConvertFrom-Json
if($cliPackage.version -ne $Version){throw "CLI version drift: $($cliPackage.version)"}
$plugin=Join-Path $caseRoot 'plugin'
New-Item -ItemType Directory -Path $plugin -Force | Out-Null
foreach($entry in 'src','lib','tests','scripts','package.json','cordis.patch.yml','tsconfig.json'){
  Copy-Item -LiteralPath (Join-Path $repo $entry) -Destination $plugin -Recurse
}
$dependencies=Join-Path $RuntimeRoot 'node_modules/.pnpm/node_modules'
if(!(Test-Path $dependencies)){throw 'Expected a pnpm runtime installation with .pnpm/node_modules'}
function Link-Package([string]$Name){
  $source=Get-Item -LiteralPath (Join-Path $dependencies $Name) -ErrorAction SilentlyContinue
  if(!$source){return}
  $target=$source.ResolveLinkTarget($true)
  if(!$target){$target=$source}
  $destination=Join-Path $plugin "node_modules/$Name"
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  New-Item -ItemType Junction -Path $destination -Target $target.FullName | Out-Null
}
$inventory=foreach($entry in Get-ChildItem -LiteralPath (Join-Path $dependencies '@deepseek-ai')){
  Link-Package "@deepseek-ai/$($entry.Name)"
  if($entry.Name -like 'dsh-*'){
    $pkg=Get-Content (Join-Path $entry.FullName 'package.json') -Raw | ConvertFrom-Json
    [pscustomobject]@{name=$pkg.name;version=$pkg.version}
  }
}
$inventory | ConvertTo-Json | Set-Content (Join-Path $caseRoot 'dependency-versions.json')
if(@($inventory | Where-Object version -NE $Version).Count){throw 'DSH dependency drift; inspect dependency-versions.json and use a pinned runtime'}
foreach($name in 'react','js-yaml','@types/react','@types/node'){Link-Package $name}
foreach($name in '@types/react','@types/node'){
  $destination=Join-Path $plugin "node_modules/$name"
  $fallback=Join-Path $repo ".test-runs/tooling/node_modules/$name"
  if(!(Test-Path $destination) -and (Test-Path $fallback)){
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    New-Item -ItemType Junction -Path $destination -Target $fallback | Out-Null
  }
}
$previousHome=$env:DSH_HOME
try{
  $env:DSH_HOME=Join-Path $caseRoot 'home'
  & node $cli plugin --profile web add $plugin *> (Join-Path $caseRoot 'plugin-install.log')
  if($LASTEXITCODE -ne 0){throw 'Plugin installation failed; see plugin-install.log'}
}finally{$env:DSH_HOME=$previousHome}
$fingerprints=foreach($dir in 'src','lib','tests','scripts','package.json','cordis.patch.yml','tsconfig.json'){
  $entry=Get-Item -LiteralPath (Join-Path $plugin $dir)
  $files=if($entry.PSIsContainer){Get-ChildItem -LiteralPath $entry.FullName -Recurse -File}else{$entry}
  foreach($file in $files){
    [pscustomobject]@{path=[IO.Path]::GetRelativePath($plugin,$file.FullName);sha256=(Get-FileHash $file.FullName -Algorithm SHA256).Hash}
  }
}
$fingerprints | ConvertTo-Json | Set-Content (Join-Path $caseRoot 'source-fingerprints.json')
$manifest=[ordered]@{version=$Version;runId=$RunId;commit=(& git -C $repo rev-parse HEAD);runtimeRoot=$RuntimeRoot;cli=$cli;plugin=$plugin;home=(Join-Path $caseRoot 'home');port=$Port;pid=$null}
$manifest | ConvertTo-Json | Set-Content (Join-Path $caseRoot 'runtime.json')
Write-Output (Join-Path $caseRoot 'runtime.json')
