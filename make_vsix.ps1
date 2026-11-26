$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$stage = Join-Path $root 'vsix_stage'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$stage\extension" | Out-Null

Copy-Item "$root\extension.vsixmanifest" "$stage\"
Copy-Item "$root\package.json","$root\README.md","$root\LICENSE","$root\icon.png" "$stage\extension\"
Copy-Item -Recurse "$root\out" "$stage\extension\"

$zip = Join-Path $root 'hexmap-0.1.0.zip'
$vsix = Join-Path $root 'hexmap-0.1.0.vsix'
$oldVsix = Join-Path $root 'hexviewer-0.1.0.vsix'
Remove-Item -Force $zip,$vsix,$oldVsix -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage\*" -DestinationPath $zip -Force
Rename-Item $zip $vsix
Remove-Item -Recurse -Force $stage
Get-Item $vsix | Select-Object Name,Length
