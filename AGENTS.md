# Framilo Agent 协作规范

## Purpose and precedence
- Framilo is a Windows/Eagle video reference and annotation player for fluent observation, precise frame inspection and notes.
- Subject to system/developer instructions, current owner requests and applicable authorization take precedence over this file, then referenced documents. Local AGENTS apply within their scope; history does not renew authorization.

## Authority
- Reviews and proposals are read-only. Change requests authorize scoped local edits and non-destructive checks; do not re-ask settled permissions.
- Environment changes, real-data operations, remote writes/releases and deletion outside the project require explicit approval under [development-plan.md: authority](docs/development-plan.md#权限边界).

## Product and code boundaries
- Follow [product.md](docs/product.md) and [architecture.md: modules](docs/architecture.md#现行模块地图). Keep UI, Eagle API, media and cache logic out of the entry point; avoid unrelated refactoring.
- Write only to designated directories. Never send assets, annotations, preferences or credentials over the network. Protect user data, unknown/active files and original evidence, including ignored files during migration. Git rollback cannot undo library writes; no nested repositories or history rewriting.

## Workflow
- Read the [project map](docs/project-profile.md) and [handoff](docs/progress.md), then relevant topics and local AGENTS. Re-read changed files; do not read all history by default.
- Define scope and completion criteria before editing; register goals, steps and budgets for multi-stage work. Continue approved implementation, checks and repairs. Pause only dependent work for necessary acceptance, unresolved major choices or unapproved restricted actions.
- For unfamiliar technology, compatibility questions or unexplained failures, check local evidence and version-matched primary sources. Follow [development-plan.md: investigation](docs/development-plan.md#调查与受阻处理): separate goals from hypotheses, check prerequisites, and stop unchanged retries without new evidence. Never bypass permissions.

## Validation and delivery
- Run affected checks in [verification.md](docs/verification.md), including applicable notification, persistence and performance checks. Confirm side effects and approved directories/budgets; do not default to old experiments, resets or sample generation/imports.
- Proactively provide interactive previews for visible frontend changes, using built-in official Browser Use. Follow [development-plan.md: preview and browser rules](docs/development-plan.md#前端预览与反馈流程) for isolation, browser selection, availability and recovery; never use mouse control.
- Completion requires agreed criteria and necessary acceptance, with evidence and remaining limits recorded. Separate implementation, models, browsers, real Eagle and owner feedback; commits or task switches do not imply passage. Apply [development-plan.md: acceptance and handoff](docs/development-plan.md#状态接续与冲突).
- Reply briefly in Chinese; explain necessary jargon. Codex runs checks and measurements; the owner assesses experience. Commit complete units locally under [development-plan.md: Git](docs/development-plan.md#git提交边界), preserving other work; never push automatically. Report changes, checks, limits and the short hash.

## Maintenance
- Keep durable rules here; merge evidence-supported recurring lessons into their owning documents and explain changes. Follow [development-plan.md: maintenance](docs/development-plan.md#文档维护机制) for synchronization, language and rule replacement, not dated patches.
- Verify files and target headings/lines before citing. Scripts check structure and links, not semantic correctness or chat-link usability.
- Clean task outputs under [development-plan.md: F-01–F-07](docs/development-plan.md#文件整理f-01f-07), protecting required evidence, archived prototypes and sole delivery packages. Git ignore is not deletion permission.
