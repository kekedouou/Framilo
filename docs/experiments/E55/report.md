# E55 execution record

Baseline 14edb4e, clean inherited worktree. User approved package slimming and user-monitor removal, explicitly retaining video compatibility. Implementation/local verification complete; private ZIP creation follows the clean source commit. No Eagle installation, library/annotation/settings writes, media generation, dependency installation, publication or remote push.

## Implemented scope and size

| Native executable | Bytes | Decision |
| --- | ---: | --- |
| Baseline | 29,210,112 | Preserved in Git 14edb4e and existing private snapshot |
| Development names/symbols removed | 25,764,864 | Comparison candidate only |
| Symbols removed + thin whole-program optimization | 9,693,696 | Promoted after functional/timing comparisons |

Only compiler/linker options changed: no container/codec registrations, CPU/GPU fallback, proxy recipe, 4K, frame mapping or audio functionality removed. Selected SHA256: `9648da4fd2f72b362b61665cd5bd1ab957fc019365983cda07084fce487f87b2`. `native/filmcraft/build.ps1` defaults to thin optimization and records flags in build metadata; `-WholeProgram false` provides the safe stripped build route.

Shared rate/RAM/window helpers moved unchanged into `playback-common.js`; the formal native player/UI no longer load the retired JPEG player and four browser preview/decoder services. These five development sources remain for historical regressions but leave the formal package. Shared backend/cache/audio/legacy-cleanup code remains because current execution and migration still use it. JPEG was already retired from user settings before E55; this stage does not re-decide that product choice.

Removed the user performance monitor entry, detached window and observer wiring. Eight monitor-only source files moved to [the archive](../../history/retired-monitor-e55/README.md), with original/current hashes and source commit; only its archived live-resource import changes to the retained storage module. Existing observer/storage regressions use the archive, never a production import. Internal on-demand diagnostics, resource accounting and safety budgets remain.

No installed verified text minifier was available. Did not install another dependency or apply unsafe whitespace stripping for small prospective gains. Existing animation/material/settings/record behavior remains. Manifest is `0.2.0-private.2`; plugin ID unchanged.

Native runtime/license closure: 72 files, 11,097,000 bytes, 132 dependency packages / 68 license texts, all artifact/license/source guards passed. Final ZIP size/source commit will be recorded after snapshot creation; old packages are retained for recovery.

## Native evidence and timing limits

Evidence: `verification-runs/e55/native-compare-1793589617523.json`, console log, `selection.json`, `thin-build.log`; raw records remain unchanged. Existing owned E52 samples only: 15 files / 17 CPU/GPU combinations / five exact frames per executable = 255 frame results. All selected-candidate and stripped pixels match baseline; NativeReader verifies source PTS identity, all processes acknowledge close. H.264 720p and UHD hardware runs report hardware-decoded frames with zero fallback; this is not all-device GPU certification.

Fixed-target timing uses three rounds, rotating program order, eight requests per executable/round (144 requests). Representative CPU medians across rounds:

| Sample | Baseline open / frame median | Selected open / frame median |
| --- | ---: | ---: |
| H.264 720p | 17.45 / 0.95 ms | 18.15 / 0.66 ms |
| H.264 UHD | 18.16 / 53.78 ms | 18.77 / 55.09 ms |

Observed worst requests were 4.23→4.51 ms and 194.85→196.90 ms respectively. These small local samples show no material regression justifying rejecting the smaller candidate; they do not prove faster playback, P-01/P-02 latency, Eagle input/presentation, audio audibility or long-session stability. No claim of universal performance improvement.

`scripts/e55-native-compare.cjs` is explicit, not a default test. Reproduction requires rebuilding candidates and restoring the baseline executable from Git 14edb4e; after promotion pass that restored path as the first argument. SHA guard prevents accidentally comparing the new executable to itself. Preserve original records and use new timestamped outputs within the approved budget.

## Regression and frontend evidence

`node scripts/check.cjs --without-prepared-host` passed; full output `verification-runs/e55/default-check-complete.log`. It includes shared helper parity/RAM lifecycle and package exclusion, 57 native-player models, application/session/proxy/audio/loop/frame/close models, historical package and window-entry checks, source/assets and document governance. Native/license closure also passed independently. These checks use owned models/fixtures, not real Eagle writes or media generation.

Initial full-check attempts failed on retired-service injection expectations, the historical Beta fixture reading moved monitor sources, and the window harness requiring the old player script. Updated those test/development consumers to the new entry or historical archive/14edb4e inputs; retained all failing logs. Historical Beta UI fixture stays frozen rather than loading the new helper-dependent UI. The window harness now records the common helper and accepts the immediately preceding source list only for explicit preparation, never for launch verification. No old product component was restored to satisfy a stale test.

Shared frontend preview: `http://127.0.0.1:5800/8c201fc539f8a31e3b9e2246c4e5088eac93/`; receipt `verification-runs/e55/preview-server.json`, PID3584 at creation, command entry `start-preview.cjs`. Semantic ego-browser task1 verified new helper present, old player/monitor absent, settings/advanced without empty monitor action, three record thumbnails and selected-record text. Screenshots `settings-without-monitor.png` and `records-after-slim.png`, browser proof and round scripts retained. A click on an auto-hidden dock was intercepted by the video; used semantic focus/Enter to reach the visible state. No mouse control or real-data writes. Task finished retaining the result page; server remains available for feedback, not guaranteed across machine restart.

Preview uses shared product UI plus synthetic sample/host adapters, not Eagle, native window controls, GPU or real cache operations. Existing preview drafts/servers untouched. If stopped, use the standard preview command and new receipt URL; before stopping identify the exact process/command from this receipt, never kill another service. Real Eagle audio/handfeel/long-use and prior E53/E54 acceptance gaps remain.

## Maintenance, budgets and remaining delivery

Product records monitor/JPEG retirement; architecture records helper/runtime/archive ownership; verification and performance workflow record parity/timing/package gates; roadmap retains compatibility and prioritizes private stability; native build and private-package guide record new build/recovery behavior. Project map links the new retired monitor archive. README branding/use and E49/E53 historical results stay frozen because product identity, accepted historical evidence and release scope did not change. AGENTS and development workflow need no new general rule.

E55 output budget128 MiB, existing E44 tool/build budget8 GiB, dist256 MiB unchanged. E44 measured 4,399,116,304 bytes after rebuilding. Preserve raw measurements/failures/screenshots, old snapshots and all user data; after new ZIP verification remove only owned rebuildable candidate duplicates, with path/hash/byte receipt. No old evidence is deleted to meet quotas. Package receipt and final cleanup results follow in this record.
