---
id: T02
parent: S01
milestone: M041
key_files:
  - src/knowledge/canonical-code-chunker.ts
  - src/knowledge/canonical-code-chunker.test.ts
  - src/knowledge/index.ts
  - .gsd/milestones/M041/slices/S01/tasks/T02-SUMMARY.md
key_decisions:
  - Keep canonical current-code chunking in a dedicated module with its own chunk/result types and exclusion helpers rather than reusing diff-hunk chunk structures.
  - Emit an explicit block fallback for symbol-poor C++ files only when no function/class boundary is discoverable, while preserving module context chunks when symbol chunks do exist.
duration: 
verification_result: passed
completed_at: 2026-04-05T14:04:33.336Z
blocker_discovered: false
---

# T02: Added a dedicated canonical code chunker with auditable exclusion reasons, function/class/module boundaries, and symbol-poor C++ block fallback.

**Added a dedicated canonical code chunker with auditable exclusion reasons, function/class/module boundaries, and symbol-poor C++ block fallback.**

## What Happened

Built a separate canonical current-code chunker in src/knowledge/canonical-code-chunker.ts instead of extending the historical diff-hunk chunker. Added explicit exclusion rules for generated paths, vendored code, lockfiles, build outputs, and binary/assets; implemented Python class/function/module chunking; implemented brace-aware C++/TypeScript/JavaScript class/function chunking with module remainder support; and added an explicit block fallback for symbol-poor C++ files when no symbol boundary is detectable. Exposed observability through excluded/exclusionReason/boundaryDecisions on every result, exported the new API from src/knowledge/index.ts, and added focused tests covering exclusions, boundaries, fallback behavior, and content-hash stability.

## Verification

Ran bun test ./src/knowledge/canonical-code-chunker.test.ts and bun run tsc --noEmit. The first test run exposed an incorrect module-vs-block fallback for symbol-poor C++ content; after tightening that branch, the canonical chunker test suite passed 7/7 and the workspace typecheck passed cleanly.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/canonical-code-chunker.test.ts` | 0 | ✅ pass | 30ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 0ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/canonical-code-chunker.ts`
- `src/knowledge/canonical-code-chunker.test.ts`
- `src/knowledge/index.ts`
- `.gsd/milestones/M041/slices/S01/tasks/T02-SUMMARY.md`
