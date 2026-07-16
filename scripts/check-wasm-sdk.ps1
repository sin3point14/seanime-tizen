$ErrorActionPreference = "Stop"

$emcc = Get-Command emcc -ErrorAction SilentlyContinue
if (-not $emcc -and $env:EMSDK) {
  $candidate = Join-Path $env:EMSDK "upstream\emscripten\emcc.bat"
  if (Test-Path -LiteralPath $candidate) { $emcc = Get-Item -LiteralPath $candidate }
}
if (-not $emcc) {
  $candidate = "C:\SamsungWasmSDK\emscripten-release-bundle\emsdk\fastcomp\emscripten\emcc.bat"
  if (Test-Path -LiteralPath $candidate) { $emcc = Get-Item -LiteralPath $candidate }
}

if (-not $emcc) {
  Write-Error @"
Samsung's modified Emscripten SDK is not available.
Install Samsung Emscripten 1.39.4.7 for Windows, activate it, and set EMSDK.
Download: https://developer.samsung.com/SmartTV/develop/extension-libraries/webassembly/download.html
"@
}

$emccPath = if ($emcc -is [System.IO.FileInfo]) { $emcc.FullName } else { $emcc.Source }
$version = & $emccPath --version 2>&1 | Out-String
Write-Output $version.Trim()
if ($version -notmatch "1\.39\.4") {
  Write-Warning "Samsung documents Emscripten 1.39.4.7 for Tizen WASM Player. Verify this compiler includes ENVIRONMENT_MAY_BE_TIZEN."
}

$tizen = "C:\tizen-studio\tools\ide\bin\tizen.bat"
if (-not (Test-Path -LiteralPath $tizen)) { Write-Error "Tizen Studio CLI was not found at $tizen." }
Write-Output "Tizen Studio: $tizen"
Write-Output "Required flags: -s ENVIRONMENT_MAY_BE_TIZEN -pthread -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=1"
