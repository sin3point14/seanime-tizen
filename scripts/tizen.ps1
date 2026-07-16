param(
  [ValidateSet("build", "package", "install", "launch", "deploy")]
  [string]$Action = "deploy",
  [string]$Profile = $env:TIZEN_CERT_PROFILE,
  [string]$Device = $env:TIZEN_DEVICE
)

$ErrorActionPreference = "Stop"
$Project = Split-Path -Parent $PSScriptRoot
$Tizen = if ($env:TIZEN_CLI) { $env:TIZEN_CLI } else { "C:\tizen-studio\tools\ide\bin\tizen.bat" }
$Sdb = if ($env:SDB) { $env:SDB } else { "C:\tizen-studio\tools\sdb.exe" }
$Build = Join-Path $Project ".tizen-build"
$Output = Join-Path $Project "tizen-output"
$PackageOutput = Join-Path $Project "tizen-package"
$AppId = "orgseanime.SeanimeTV"

function Reset-ProjectDirectory([string]$Path) {
  $ResolvedProject = [System.IO.Path]::GetFullPath($Project)
  $ResolvedPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $ResolvedPath.StartsWith($ResolvedProject + [System.IO.Path]::DirectorySeparatorChar)) { throw "Unsafe project directory: $ResolvedPath" }
  if (Test-Path -LiteralPath $ResolvedPath) { Remove-Item -LiteralPath $ResolvedPath -Recurse -Force }
  New-Item -ItemType Directory -Path $ResolvedPath | Out-Null
}

function Build-App {
  Push-Location $Project
  try { npm.cmd run build } finally { Pop-Location }
  Reset-ProjectDirectory $Build
  Reset-ProjectDirectory $Output
  Copy-Item -Path (Join-Path $Project "dist\*") -Destination $Build -Recurse
  Copy-Item -LiteralPath (Join-Path $Project "config.xml") -Destination $Build
  $icon = Join-Path $Project "icon.png"
  if (Test-Path -LiteralPath $icon) { Copy-Item -LiteralPath $icon -Destination $Build }
  & $Tizen build-web --output $Output -- $Build
  if ($LASTEXITCODE -ne 0) { throw "Tizen build failed" }
}

function Package-App {
  if (-not $Profile) { throw "Set TIZEN_CERT_PROFILE to a Samsung certificate profile containing the TV DUID." }
  Reset-ProjectDirectory $PackageOutput
  & $Tizen package --type wgt --sign $Profile --output $PackageOutput -- $Output
  if ($LASTEXITCODE -ne 0) { throw "Tizen package failed" }
  # Samsung's TV installer can fail silently when a WGT filename contains spaces.
  $package = Get-ChildItem $PackageOutput -Filter *.wgt | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($package -and $package.Name -match '\s') {
    $safeName = ($package.BaseName -replace '[^A-Za-z0-9_.-]', '') + $package.Extension
    Copy-Item -LiteralPath $package.FullName -Destination (Join-Path $PackageOutput $safeName) -Force
  }
}

function Resolve-Serial {
  if ($Device) {
    $existing = (& $Sdb devices | Select-String ([regex]::Escape($Device)) | Select-Object -First 1).Line
    if (-not $existing) {
      & $Sdb connect $Device | Out-Host
      Start-Sleep -Milliseconds 500
    }
    return $Device
  }
  $line = (& $Sdb devices | Select-String "\sdevice\s" | Select-Object -First 1).Line
  if (-not $line) { throw "No connected Tizen device found." }
  return ($line -split "\s+")[0]
}

function Resolve-Target {
  $serial = Resolve-Serial
  $line = (& $Sdb devices | Select-String ([regex]::Escape($serial)) | Select-Object -First 1).Line
  if (-not $line) { throw "No Tizen target found for serial $serial." }
  $parts = @($line -split "\s+" | Where-Object { $_ })
  if ($parts.Count -lt 3) { throw "Could not determine target name from: $line" }
  return $parts[2]
}

function Install-App {
  $target = Resolve-Target
  $wgt = Get-ChildItem $PackageOutput -Filter *.wgt -Recurse | Where-Object { $_.Name -notmatch '\s' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $wgt) { throw "No WGT found. Package the application first." }
  & $Tizen install --name $wgt.Name --target $target -- (Split-Path $wgt.FullName)
  if ($LASTEXITCODE -ne 0) { throw "Tizen install failed" }
}

function Launch-App {
  & $Tizen run --pkgid $AppId --target (Resolve-Target)
  if ($LASTEXITCODE -ne 0) { throw "Tizen launch failed" }
}

switch ($Action) {
  "build" { Build-App }
  "package" { Build-App; Package-App }
  "install" { Install-App }
  "launch" { Launch-App }
  "deploy" { Build-App; Package-App; Install-App; Launch-App }
}
