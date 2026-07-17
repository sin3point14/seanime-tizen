param([string]$Sdk = $(if ($env:EMSDK) { $env:EMSDK } else { "C:\SamsungWasmSDK\emscripten-release-bundle\emsdk" }))
$ErrorActionPreference = "Stop"
$Project = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Project "native\wasm-player\seanime_wasm_player.cc"
$Output = Join-Path $Project "public\wasm-player"
$EnvScript = Join-Path $Sdk "emsdk_env.bat"
if (-not (Test-Path -LiteralPath $EnvScript)) { throw "Samsung Emscripten SDK was not found at $Sdk. Run npm run wasm:check." }
New-Item -ItemType Directory -Force -Path $Output | Out-Null

$arguments = @(
  "em++ -std=gnu++14 -O3 `"$Source`" -o `"$Output\seanime-wasm-player.js`"",
  "-s ENVIRONMENT_MAY_BE_TIZEN=1 -s USE_FFMPEG=1 -s FETCH=1",
  "-pthread -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=1",
  "-s TOTAL_MEMORY=134217728 -s ALLOW_MEMORY_GROWTH=1 -s WASM_MEM_MAX=536870912",
  "-s EXPORTED_FUNCTIONS=`"['_main','_seanime_open','_seanime_play','_seanime_pause','_seanime_seek','_seanime_stop','_seanime_duration','_seanime_current_time','_seanime_state','_seanime_bandwidth']`"",
  "-s EXTRA_EXPORTED_RUNTIME_METHODS=`"['cwrap']`""
) -join " "
$command = "call `"$EnvScript`" && $arguments"
cmd.exe /d /c $command
if ($LASTEXITCODE -ne 0) { throw "Samsung WASM Player build failed." }
$fetchWorker = Join-Path $Project "seanime-wasm-player.fetch.js"
if (Test-Path -LiteralPath $fetchWorker) { Move-Item -LiteralPath $fetchWorker -Destination (Join-Path $Output "seanime-wasm-player.fetch.js") -Force }
# Emscripten 1.39's fetch worker uses the obsolete Atomics.wake alias. Modern
# Tizen WebKit exposes the standardized Atomics.notify name.
Get-ChildItem -LiteralPath $Output -Filter "seanime-wasm-player*.js" | ForEach-Object {
  $content = [System.IO.File]::ReadAllText($_.FullName)
  if ($content.Contains("Atomics.wake")) {
    [System.IO.File]::WriteAllText($_.FullName, $content.Replace("Atomics.wake", "Atomics.notify"), [System.Text.UTF8Encoding]::new($false))
  }
}
Write-Output "Built Samsung WASM Player in $Output"
