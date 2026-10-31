# E52 planning record

2026-10-31. Planning baseline: ec5d7cc; runtime candidate remains 3a6d5af. This unit records the user's second-stage refinement, not an implementation or release result.

The plan narrows the proposed format targets, separates a shared-UI browser preview from Eagle/native performance acceptance, and adopts a 1 GB consent threshold plus removal of all regenerable media caches on exit. The user explicitly accepts regeneration on reopening, including JPEG and RAM hits. Permanent annotations, source media and preferences remain protected.

User-facing planning text is Chinese because this artifact is for product review; implementation details and outcomes will be added here in English. Format scope, browser/native constraints and lifecycle safety are explicit gates. No native changes, cache deletion, media generation, dependency installation, Eagle loading or library writes occurred. No performance experiment is necessary for this documentation-only unit; implementation will require bounded media/lifecycle measurements.

Documentation impact: product requirements updated in place for agreed future behavior, with the previous runtime contract distinguished; capability page corrects the MKV/audio evidence limit; roadmap and stage index point to the plan; architecture links the proposed adaptation without pretending it is deployed. Verification adds target-case gates. Current handoff is replaced in its sole owning file. AGENTS/workflow, frozen E49 and original E51 evidence are unchanged because general rules and historical results did not change. No report.html workflow is restored.

Validation: check-docs passed (179 documents, 1319 links); diff --check and check-handoff --base HEAD passed for the 9-file documentation scope. Post-commit require-clean is required before delivery. No temporary media/output cleanup required in this unit. No runtime, browser or performance validation was run because only the plan and documentation changed.
