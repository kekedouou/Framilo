$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$e44Root = [IO.Path]::GetFullPath((Join-Path $projectRoot 'verification-runs/e44'))
if (-not (Test-Path Q:/)) { subst Q: $e44Root }
$mapping = (subst | Where-Object { $_ -like 'Q:*' }) -join ''
if ($mapping -notlike "*$e44Root*") { throw 'Q: is not this E44 workspace' }
$sourceRoot = 'Q:/filmcraft-source/filmcraft-176e6a9c585fd29e4b18d691663fe88a936c5b37'
node (Join-Path $PSScriptRoot 'patch-audit.cjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bridge.rs') -Destination "$sourceRoot/crates/platform/examples/e44_bridge.rs"
$env:RUSTUP_HOME='Q:\filmcraft-tools\rustup'
$env:CARGO_HOME='Q:\filmcraft-tools\cargo'
$env:PATH="Q:\filmcraft-tools\shims;$env:CARGO_HOME\bin;$env:PATH"
$env:CARGO_TARGET_DIR='Q:\filmcraft-tools\target'
$env:CARGO_BUILD_JOBS='2'
$env:CARGO_PROFILE_RELEASE_LTO='false'
$env:CARGO_PROFILE_RELEASE_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
$used = (Get-ChildItem -LiteralPath $e44Root -Recurse -File | Measure-Object Length -Sum).Sum
if ($used -gt 7.5GB) { throw 'Approaching 8 GiB cumulative budget' }
$logPath = 'Q:/filmcraft-test/build-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '.log'
$linker='Q:/filmcraft-tools/rustup/toolchains/1.95.0-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe'
foreach ($exampleName in @('mfprobe','mfcaps','e44_bridge')) {
    $ErrorActionPreference = 'Continue' # Windows PowerShell treats native stderr warnings as errors.
    & "$env:CARGO_HOME\bin\cargo.exe" rustc --release --locked --manifest-path "$sourceRoot/Cargo.toml" -p filmcraft-platform --example $exampleName -- -C "linker=$linker" -C linker-flavor=ld.lld -C link-self-contained=yes 2>&1 | Tee-Object -FilePath $logPath -Append
    $buildExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($buildExitCode -ne 0) {exit $buildExitCode}
}
exit 0
