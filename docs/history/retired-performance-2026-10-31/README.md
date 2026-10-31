# Retired performance source archive

This is a historical source snapshot, not a runnable toolset or product dependency. The user approved archiving these 40 files in local Git before removing their original working paths. The three Codex UI probe files remain outside this archive and uncommitted.

- [Manifest](manifest.json): original/archive paths, exact byte counts and SHA256 hashes; .gitattributes prevents line-ending conversion of source files.
- [Previous inventory](../2026-10-31/source-manifest.json): independent original identities. These files had no commits at their original paths; this archive establishes recovery without restoring retired functionality.
- [Maintenance record](../../progress/2026-10-31-retired-performance-archive.md): approval, migration results, checks and retained exceptions.
- [E45 report](../../experiments/E45/report.md): original retirement and rejected cleanup history, unchanged.

Contents: 6 old product modules, 24 experiment/report/cleanup scripts, 5 retired test suites and 5 helpers; 285046 bytes. Original evidence, videos, caches, binaries and personal settings are not moved or deleted. This does not execute E45's broader 1602-file cleanup proposal.

Recovery: retrieve this directory from its archive commit and use the manifest to locate exact historical source bytes. Inspect code only by default. Relative imports, old media paths, dependencies and permissions may no longer be valid; restoring a file is not permission to run it. Do not copy this archive into the production plugin or release bundle.
