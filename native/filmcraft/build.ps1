param([string]$OutputDirectory = '', [ValidateSet('false','thin')][string]$WholeProgram = 'thin')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$e44Root = [IO.Path]::GetFullPath((Join-Path $projectRoot 'verification-runs/e44'))
if (-not (Test-Path Q:/)) { subst Q: $e44Root }
$mapping = (subst | Where-Object { $_ -like 'Q:*' }) -join ''
if ($mapping -notlike "*$e44Root*") { throw 'Q: is not this E44 developer workspace' }
$sourceRoot = 'Q:/filmcraft-source/filmcraft-176e6a9c585fd29e4b18d691663fe88a936c5b37'
node (Join-Path $PSScriptRoot 'patch-upstream.cjs') $sourceRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$examplePath = "$sourceRoot/crates/platform/examples/eagle_media.rs"
$bridge = Join-Path $PSScriptRoot 'bridge.rs'
if (-not (Test-Path -LiteralPath $examplePath) -or (Get-FileHash -LiteralPath $bridge).Hash -ne (Get-FileHash -LiteralPath $examplePath).Hash) {
    Copy-Item -LiteralPath $bridge -Destination $examplePath
}
$env:RUSTUP_HOME='Q:\filmcraft-tools\rustup'
$env:CARGO_HOME='Q:\filmcraft-tools\cargo'
$env:PATH="Q:\filmcraft-tools\shims;$env:CARGO_HOME\bin;$env:PATH"
$env:CARGO_TARGET_DIR='Q:\filmcraft-tools\target'
$env:CARGO_BUILD_JOBS='2'
$env:CARGO_PROFILE_RELEASE_LTO=$WholeProgram
$env:CARGO_PROFILE_RELEASE_DEBUG='0'
$env:CARGO_PROFILE_RELEASE_STRIP='symbols'
$env:CARGO_INCREMENTAL='0'
$used = (Get-ChildItem -LiteralPath $e44Root -Recurse -File | Measure-Object Length -Sum).Sum
if ($used -gt 7.5GB) { throw 'Approaching 8 GiB cumulative developer budget' }
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$logPath = "Q:/filmcraft-test/native-build-$stamp.log"
$linker='Q:/filmcraft-tools/rustup/toolchains/1.95.0-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe'
$ErrorActionPreference = 'Continue'
& "$env:CARGO_HOME\bin\cargo.exe" rustc --release --locked --manifest-path "$sourceRoot/Cargo.toml" -p filmcraft-platform --example eagle_media -- -C "linker=$linker" -C linker-flavor=ld.lld -C link-self-contained=yes 2>&1 | Tee-Object -FilePath $logPath
$buildExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($buildExitCode -ne 0) { exit $buildExitCode }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'plugin/bin' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $OutputDirectory.StartsWith($projectRoot+[IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must remain in project workspace' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$ErrorActionPreference = 'Continue'
& "$env:CARGO_HOME\bin\cargo.exe" tree --locked --offline --manifest-path "$sourceRoot/Cargo.toml" -p filmcraft-platform -e normal --target x86_64-pc-windows-gnu --prefix none --format '{p}|{l}' | Out-File -LiteralPath 'Q:/filmcraft-test/native-cargo-tree.txt' -Encoding utf8
$treeExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($treeExitCode -ne 0) { exit $treeExitCode }
node (Join-Path $PSScriptRoot 'notices.cjs') $sourceRoot $OutputDirectory
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath 'Q:/filmcraft-tools/target/release/examples/eagle_media.exe' -Destination (Join-Path $OutputDirectory 'filmcraft-media.exe')
foreach ($license in @('LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $license) -Destination (Join-Path $OutputDirectory ('FilmCraft-'+$license))
}
$buildInfo = [ordered]@{
    schema=1; created=[DateTimeOffset]::Now.ToString('o'); upstream='https://github.com/storytold/filmcraft'; upstreamCommit='176e6a9c585fd29e4b18d691663fe88a936c5b37'; version='0.13.0'; protocol=2;
    bridgeSha256=(Get-FileHash -LiteralPath $bridge).Hash.ToLowerInvariant(); patchSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'patch-upstream.cjs')).Hash.ToLowerInvariant();
    binarySha256=(Get-FileHash -LiteralPath (Join-Path $OutputDirectory 'filmcraft-media.exe')).Hash.ToLowerInvariant(); binaryBytes=(Get-Item -LiteralPath (Join-Path $OutputDirectory 'filmcraft-media.exe')).Length;
    dependencyNoticesSha256=(Get-FileHash -LiteralPath (Join-Path $OutputDirectory 'filmcraft-third-party.txt')).Hash.ToLowerInvariant();
    compiler='rustc 1.95.0 x86_64-pc-windows-gnu'; linker='rust-lld / ld.lld / link-self-contained'; wholeProgram=$WholeProgram; stripped='symbols'; buildLog=(Split-Path $logPath -Leaf)
}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'filmcraft-media.build.json'), (($buildInfo | ConvertTo-Json) -replace "`r`n", "`n"), [Text.UTF8Encoding]::new($false))
Write-Output "Built standalone native media bridge: $OutputDirectory"
exit 0
