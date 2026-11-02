# E55 — Private package slimming

Approved 2026-11-02: reduce package size without narrowing video compatibility; remove the user performance monitor. Baseline 14edb4e; clean inherited worktree. R-01–R-08 and P-01–P-04 remain, except the explicitly removed monitor UI.

## Work bundles
1. Preserve baseline package/native hashes; produce symbol-stripped and whole-program-optimized candidates with existing tools. Keep all format/decoder registrations, proxy recipe, GPU/CPU fallback, 4K, audio and frame accuracy unchanged. No new software/dependency installation.
2. Extract shared playback helpers from the old JPEG player. Remove retired frontend playback/preview scripts from the production entry/package; retain necessary shared/cache migration code and historical development regressions. No user annotation/settings/cache deletion.
3. Remove monitor entry, detached window, observation wiring and panel-only packaged files. Keep private development diagnostics and essential playback/resource accounting. Preserve existing material/animation style.
4. Use only an already available, verified minifier if feasible; do not implement an unsafe whitespace stripper. Compare any packaging-only transformation and reject breakage/negligible gains.
5. Update product/architecture/verification/performance workflow, current roadmap priorities and private-package instructions; create one new verified ZIP alongside recoverable baseline. No installation/publishing/push.

## Budgets, checks and acceptance
E55 outputs <=128 MiB under verification-runs/e55; reuse existing owned E52 samples, no media generation or Eagle/library writes. Existing E44 tools/build target remain within 8 GiB cumulative; dist within 256 MiB. Inspect known paths/identities before removing this task's rebuildable intermediates; preserve failure/measurement evidence and sole candidates.
Performance checks are necessary because the native executable and helper wiring change. Compare baseline/candidate exact frame pixels/PTS, first open and fixed seek timing on the same synthetic samples; cover CPU/GPU, supported containers/representative encodings, 4K, audio-copy/clock models, pause/seek/loop, RAM accounting and close. Short local results are not Eagle handfeel/long stability acceptance. Run focused plus default regressions and native/license/package closure.
Visible monitor removal requires the shared frontend preview and semantic browser check; no simulated success for host/GPU/cache operations. Preserve old preview drafts. Keep the smallest candidate only if functional/accuracy checks pass and no material timing regression is shown; retain/revert the safe stripped candidate otherwise. Compiler/package size estimates are not results.
