# E54 — Plugin drawing lifetime

Approved 2026-11-02: implement missing plugin-only drawing cleanup and document the final plugin/standalone ownership model. Baseline be82bba; no inherited tracked changes.

## Scope and boundaries

- R-05/data protection: drawings remain in plugin/annotation-data; no AppData migration or library writes. Confirmed permanent asset removal can reclaim only its owned drawing revisions. Trash, unavailable/changed libraries, ambiguous API responses, drafts, active assets and unknown files remain protected.
- Read-only adapter probes Eagle and the ordinary images/<itemId>.info layout. Maintenance runs on opening/focus and a bounded asynchronous idle pass; no media-path scans or synchronous full-library enumeration.
- Installed Eagle code inspection distinguishes official uninstall (removes installed plugin folder) from developer unregister (preserves source folder). Do not patch Eagle or simulate uninstall by deleting real user data. No public uninstall hook is assumed.
- Standalone and linkage are documentation only: dedicated permanent storage, missing references, import/export and verified ownership transfer. No independent manager or extension implementation.

## Verification and budgets

Use dedicated synthetic filesystem fixtures under tests' existing annotation scratch, <=8 MiB, removed by fixture ownership checks. Never import/delete a real Eagle asset, uninstall a live plugin or mutate existing annotation-data. Inventory store read/save/maintenance and all lifecycle callbacks. Cover old format/reopening, trash, permanent deletion, errors/links/unknown files, interruption/retry, stale identity, active writes and stop/reopen. New checks join default suite.

Performance necessity: cleanup adds background I/O. Verify asynchronous yielding, one in-flight pass, bounded work/cancellation and no interval active after close; no codec benchmark is needed because media code is unchanged. Pure backend change: frontend preview not applicable. Actual Eagle permanent-delete/uninstall remains a host acceptance gate; source inspection is not an uninstall test.
