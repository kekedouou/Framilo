$ErrorActionPreference = 'Stop'
$imeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$imeToolRoot = Join-Path $imeRoot 'verification-runs/e44/filmcraft-tools'
$imeCompilerRoot = Join-Path $imeToolRoot 'rustup/toolchains/1.95.0-x86_64-pc-windows-gnu'
$imeEvidence = Join-Path $imeRoot 'verification-runs/bugfix-four/note02-recurrence'
$imeBudgetRoot = Join-Path $imeRoot 'verification-runs/bugfix-four'
if ((Get-ChildItem -LiteralPath $imeBudgetRoot -Recurse -File | Measure-Object Length -Sum).Sum -gt (2MB - 512KB)) { throw 'Not enough existing task budget for this build' }
$imeOut = Join-Path $imeEvidence 'ime-cancel-probe-v2.exe'
if (Test-Path -LiteralPath $imeOut) { throw 'Preserve existing binary evidence before rebuilding' }
$imeOriginalPath = $env:PATH
try {
 $env:PATH = (Join-Path $imeToolRoot 'shims') + ';' + $env:PATH
 & (Join-Path $imeCompilerRoot 'bin/rustc.exe') (Join-Path $PSScriptRoot 'probe.rs') --edition 2024 --target x86_64-pc-windows-gnu -C opt-level=s -C panic=abort -C lto=true -C strip=symbols -C "linker=$imeCompilerRoot/lib/rustlib/x86_64-pc-windows-gnu/bin/rust-lld.exe" -C linker-flavor=ld.lld -C link-self-contained=no -C link-arg=--entry=mainCRTStartup -L "native=$imeCompilerRoot/lib/rustlib/x86_64-pc-windows-gnu/lib/self-contained" -o $imeOut
 if ($LASTEXITCODE -ne 0) { throw "rustc failed: $LASTEXITCODE" }
 $imeBytes = (Get-Item -LiteralPath $imeOut).Length
 if ($imeBytes -gt 512KB) { throw 'Binary exceeds reserved 512 KiB; stop before any run' }
 [ordered]@{at=[DateTimeOffset]::UtcNow.ToString('o');compiler='rustc 1.95.0 Windows GNU';bytes=$imeBytes;sourceSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'probe.rs')).Hash;binarySha256=(Get-FileHash -LiteralPath $imeOut).Hash;scope='independent NOTE-02 prototype; no plugin integration'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $imeEvidence 'ime-cancel-build-v2.json') -Encoding utf8
} finally { $env:PATH = $imeOriginalPath }
