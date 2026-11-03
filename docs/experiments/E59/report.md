# E59 — Close ownership, dragging and compatibility candidate

Baseline e523c81. Source/local checks complete; private.6 is a repair candidate, not proof that progressive real-Eagle slowdown or the GPU crash is resolved. User accepted E58's concentrated experience item, authorized up to 10 read-only host cycles, then stopped further automation and chose manual experience after the UI tool failed to control closing. [Scope/budgets](plan.md).

## Findings and changes

- Native reader/backend discarded failed reader ownership or swallowed close errors; a late exit could leave a permanently rejected promise. Failed owners now stay tracked, failures propagate and explicit cleanup retry is possible. Backend replacement retains the old cleanup handle until successful release.
- Reader/audio/proxy stops start together. Temporary media blocks new spawns, signals only original ChildProcess handles after 2.5 seconds and rejects after 5 seconds if still alive. Only confirmed stopped media is erased. Session/app can still await an outstanding operation; this does not guarantee recovery from every driver hang or forcibly terminate the renderer.
- Player finally releases JS frames, thumbnails, textures and audio references even on native failure; native budget remains charged until confirmed shutdown. Session retry awaits existing annotation writes without resubmission. Removed the error-window unload bypass in favor of explicit cleanup retry.
- Header uses one windowed/fullscreen path, coalesces position updates and queries Eagle screen coordinates across mixed DPI. Restore retains drag intent through transient capture loss/blur, then recaptures. Windowed drag avoids redundant fullscreen transitions; double click retains maximize/restore. Physical dual-monitor feel, restore smoothness and OS snapping remain manual checks.

API basis: [Eagle window](https://developer.eagle.cool/plugin-api/api/window), [Eagle screen](https://developer.eagle.cool/plugin-api/api/screen), [Electron draggable regions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions). Documentation supports assumptions, not device acceptance.

## Evidence and limits

Raw receipts are preserved in verification-runs/e59.

| Check | Result and boundary |
| --- | --- |
| Default regression | default-second.log passes syntax/current tests/manifest/docs/handoff. default-first.log failed a frozen bridge relying on literal function close(); retained its wrapper and reran, without editing the prototype. |
| Targeted models | focused-second.log, interaction-data.log and app-fourth.log pass: failed close retention/retry, renderer release, no duplicate writes, child deadline/drain, negative DPI coordinates/coalescing, canceled moves and capture transitions. |
| Native cycles | baseline-1793709684309.json and candidate-1793710052982.json: 12 cycles each, 54 children per run, peak 2, zero active/live owned children after every close, equal frame hashes. Neither reproduced accumulation. Totals 8.096 s / 5.163 s are sequential warm-run results, not a controlled speedup claim. |
| Formats | formats-1793710332796.json: 16 existing synthetic formats pass CPU/GPU first/middle/last frames against independent references, 96 observations, 20.362 s wall time; includes 4K/VFR/offset/tagged color. Untagged prores.mov remains expected MEDIA_COLOR_UNVERIFIED. Source hashes unchanged. |
| Audio limit | Seven synthetic MP4/MOV AAC inputs reject copy optimization with AUDIO_TIMING and retain original-audio fallback. Listening and real audio-sync untested; audio recipes unchanged. |
| GPU evidence | gpu-events.json/raw XML contain five nvlddmkm ID153 events near the incident. Screenshot references StormEdit D3D dump; user confirms Unreal crashed. No evidence establishes Framilo as the cause. No crash induced/reproduced. |
| Actual Eagle | User opened existing plugin; accessibility URL confirms project plugin/index.html. Frame and completed proxy visible. host-open-01.json/session record show one FilmCraft child under plugin renderer; one snapshot cannot establish a memory trend. |
| Host limit | Indexed close returned geometry unavailable; Alt-F4/Tab produced no confirmed close/focus change. Zero automated close/reopen cycles completed. User explicitly stopped further attempts and chose manual experience. Input-call latency is not close latency. |

Performance checks were necessary because ownership/frame retention/window scheduling changed. Existing E52 files were reused; no native rebuild or new source media. These short runs exclude Electron window accumulation, actual display latency, listening and GPU reset recovery. summary.json records results. The earlier idle process snapshot cannot rule out prior leaks.

Persistence inventory: temporary-media writes session.json/session.next.json/child records; startup readOwner/proveGone/inventory/erase and process-identity remain readers. Schema and paths unchanged. Session owns existing pending annotation writes; drawing-store/lifetime and memory-preferences readers/writers unchanged. Local checks cover normal reopening, interruption and retry. No ordinary-library annotation/source/preference writes were issued for testing; real save/delete/uninstall remain untested.

## Preview and delivery

Production JS/CSS preview with synthetic media: http://127.0.0.1:8431/c22fd0f9cf9be8fd0c563d8e4891711a171a/ . Frame/settings visually checked; cannot validate native drag/decoding. preview-server.json identifies process21768; restore with node scripts/frontend-preview.cjs and only stop identity-matching service. Old E57 evidence/drafts retained.

private.6 is built after clean source commit. package-build.json/BUILD-INFO define exact source and identities; package-smoke.json checks packaged CPU/GPU H264 hashes/close against E55 references. distribution-cleanup receipts define replacement of verified private.5 ZIP/checksum/snapshot under latest-only preference. Receipt results determine completion; project plugin/data/source/evidence excluded.

Completed delivery: source99c8547, ZIP4,510,683 bytes, SHA256 a5206986429b7e40e868efb2d1baec60081b668bda6384f62a67306c819bed7d; archive/license/native checks and packaged smoke pass. distribution-cleanup-1793711382502.json confirms76 old files/15,620,198 bytes removed after identity/occupancy checks. Only private.6 distribution remains. Post-source changes are this receipt/handoff documentation, not runtime changes.

Receipt-only handoff initially failed because a documentation-only commit requires the explicit maintenance-record link in progress. The shell did not stop before committing that receipt. Added the missing link and rechecked the receipt scope; runtime/package identities unchanged. This is a workflow correction, not a host acceptance.

Current navigation/product/lifecycle/verification docs and E53 acceptance reconciled in place. Fixed day/count/hour quotas removed; E53 plan has supersession notice, historical result bodies and E49 frozen. No AGENTS, native codec, annotation schema or preference changes.

Manual focus: repeated normal close/reopen black-screen trend; fullscreen-to-window and dual-monitor header dragging; cleanup errors on close. Existing marks/preferences should remain visible. No fixed count/days required. Listing-document preparation follows this repair checkpoint; actual submission/publishing unauthorized.
