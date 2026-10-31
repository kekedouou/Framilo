# 验证协议与验收映射

This page defines check selection and pass criteria; actual results belong in stage reports. See [handoff](progress.md) for current status and [product requirements](product.md#性能可靠性与测量口径) for R/P targets; document maintenance must not relax them.

## 按改动选择检查
| Change | Required checks | Entry and side effects |
| --- | --- | --- |
| Documentation/workflow only | Links/anchors, roles, unique current status, history/experiment navigation, classification and semantic consistency | node scripts/check-docs.cjs is read-only; changes to check tools also need their regressions |
| Production code | Syntax, module boundaries, affected behavior, manifest/wiring | node scripts/check.cjs --without-prepared-host; may create isolated fixtures, never real media or library writes |
| Notifications/preparation choices | All timing, replacement, persistent errors, closure/mode switching below | Current tests/t1-ui.cjs, e51-decisions.cjs, etc.; browsers supplement DOM/style checks, never replace Eagle |
| Indexing/decoding/proxy/pixels | Source identity, integer PTS, frame number, independent reference, dimensions/aspect, actual CPU/GPU path, cancel/reopen | Read the stage plan first; explicit media commands may write synthetic samples/cache; never run by default |
| Cache/tasks/persistence | All readers/writers, compatibility, use, ownership, budgets, normal restart and interruption | Confirm isolated directories/budgets first; leave unknown/active data untouched |
| Host/interaction/audio/video | Real Eagle workflow, sound/image/responsiveness, annotation safety and exit | Codex automates technical checks; users assess bundles. Test-asset writes need specific authorization |

## 提示计时与准备选择
For every added/changed notification, use a controlled clock to cover:
1. Ordinary completion, capacity failure after cleanup/fallback, and safely stopped tasks fade after about 2.2 seconds.
2. Polling the same result must not restart its lifetime; only a new task/result restarts it.
3. A new ordinary notification immediately fades the old one; checking new text alone is insufficient.
4. In-progress notices leave when the task ends; cancellation/fallback/completion ordering must be correct.
5. Failed saves, unsaved work, unknown results and incomplete cleanup persist. Classify states explicitly, not by message keywords.
6. Closure/source/mode changes, cancellation/rejection and late answers must not revive stale choices or writes. No proxy write lock before confirmation. Also verify valid confirmation proceeds and reopening/reuse does not wrongly block again.

## 持久化与数据安全
Before changing formats/validation, inventory all affected producers/consumers and old records: preferences, drawings, cache manifests, owner/lease records, task/evidence ledgers.
For each affected operation, cover restart after normal completion, closure/interruption in flight, old-format reads, atomic commit/corruption/version mismatch, recovery and actual release. One exit test or a small-ID model cannot replace every entry's read/write cycle.
Save once; report success only after independent readback. Verify unknown results before retrying writes. Regress draft preservation, asset/library/source identity, same-frame drawing deletion protection and stale callbacks after source changes. Test writes/deletes require specifically authorized dedicated assets; Git rollback is not data rollback.
Cleanup must cover protection of active/current-source/unknown files and links, changed ownership/missing owners, PID reuse, quota/full-disk failures, reclaiming only after actual stop, recovery clues after cleanup failure, restart/dead-owner and multi-window protection. F-rule receipts must match before/after inventories.

## 常用格式预览与临时存储目标验证
For the [second-stage refinement](experiments/E52/plan.md), silent synthetic frames are insufficient format acceptance. Include audio, nonzero starts, missing stream durations, last-frame bounds, accurate release targets and audio/video synchronization. Gate each advertised container/codec combination on actual evidence; a filename whitelist or JPEG fallback is not support.
The browser preview must load production UI resources and isolate all writes. Verify real interactions and visibly document unsupported host/media operations; no browser timings substitute for native decoding or Eagle measurements.
For ephemeral storage, inventory every persistent producer/consumer and migrate old settings/manifests. Test cumulative consent thresholds, underestimation, refusal, disk exhaustion, source/quality changes, normal exit, interrupted generation/validation/cleanup, restart recovery and another active owner. Verify retained media bytes and RAM objects are released, while source/annotations/preferences/evidence remain identical. A close request alone is not a cleanup receipt.

## 性能与证据口径
Declare required performance checks/sampling under the [performance workflow](performance/WORKFLOW.md). Compare the same source/conditions, preserve conditions/failures, label unmeasured results unknown; do not combine best results from different versions.
- P-01/P-02: Count actual image submissions; report success/cancellation/supersession/incompletion, longest gap without submission, independent seeks and accurate final frames on release. Inputs/requests and retained old frames are not output; redraws without new targets do not inflate rate. Distinguish submissions, refresh opportunities and physical presentation.
- Original normal protocol: 3 × 30-second continuous-target rounds; retain original conditions for ≥55 submissions/second. Independent seeks: 3 × 200 targets per sample/cache condition. Three rounds each at 0/25/60ms injection apply only to the originally approved stress protocol; slower injection cannot waive normal thresholds. Recording this here does not authorize reruns.
- P-03: Per sample, 3 first complete preparations and 3 valid-cache reuse runs. Measure from this create/run/explicit-read entry until the first frame and audio are usable and controls responsive; include initialization/analysis/generation/queuing. Separate first/reuse results and unmeasured time before manifest creation.
- P-04: Managed resources include audio/frames/in-flight work. Sample process groups, FFmpeg, GPU and observation overhead separately; do not add peaks from different times. Follow specifically approved stop limits/durations; do not raise budgets or use short tests to prove long-term stability.
Consult the [original P protocol](history/2026-10-31/verification.md#p-01p-02正常轮压力轮与释放) and [resource definitions](history/2026-10-31/verification.md#p-04预算趋势与观察停止线) for detailed measurement/long-run protocols as needed. Old T2/T4 entry points are retired; links do not authorize reimports or renew permissions.
Record code/binary identity, conditions/time, source identity, sample size/success/failure and measurement boundaries. Never overwrite originals; recalculations/retests use separate bounded records. Investigate unknown failure causes first.

## 宿主与发布关卡
Standalone browsers verify only their UI/media path. Report real Eagle, background modules, complete window operations, user experience and physical listening separately. Disclose missing host automation; do not ask users to type debugging commands or add test buttons to production UI.
Stratify formats by container × codec × bit depth/HDR/alpha × frame timing × dimensions × audio. Perform basic end-to-end checks for each promised extension, performance/stability checks for representative combinations, and retest historical problem sources. See [capabilities](releases/motionote-capabilities.md) for promises/gaps.
Real Eagle coverage includes monitoring toggles on warm hits/background generation, reselecting sources from empty state, continuing source playback/reopening after capacity failure, continuous 4K playback, audio/video, drawing coordinates, asset switching, install/upgrade/closure and annotation safety. Short local samples do not complete all-material, HDR/alpha/rotation, external-installation or stability acceptance.
For release stability, fix environment/samples/budgets before 2 × 60-minute candidate runs and 50 complete open/close cycles; an old single 10-minute run does not authorize expansion. Do not repeat previously accepted experience/historical long tests merely to fill records. Preserve original R/P targets and key technical gates; see [release investigation/draft](releases/motionote-preflight.md#验证与执行顺序).
