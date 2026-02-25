---
phase: quick-11
plan: 01
status: complete
---

## Summary

Updated issue #42 (v0.19 Intelligent Retrieval Enhancements) to correct the `[depends]` PR handling scope.

### Changes

- Rewrote `[depends]` PR handling from "lighter review tone" to **deep, thorough review pipeline**
- Added: fetch upstream changelogs, analyze breaking changes, assess Kodi codebase impact
- Added: check for transitive dependency conflicts, surface structured review comment
- Added: automatic detection and triggering on `[depends]` prefix
- Emphasized: dependency bumps have hidden blast radius, need **more** scrutiny not less

### Key Decision

Dependency bump PRs are not simpler — they're harder to review because the blast radius is hidden. Kodiai should do the upstream research automatically that a human reviewer would need to do manually.
