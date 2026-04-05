---
id: T03
parent: S01
milestone: M041
key_files:
  - src/knowledge/canonical-code-ingest.ts
  - src/knowledge/canonical-code-ingest.test.ts
  - src/knowledge/index.ts
  - .gsd/milestones/M041/slices/S01/tasks/T03-SUMMARY.md
key_decisions:
  - Keep canonical snapshot ingest as a dedicated orchestrator over canonical chunker plus canonical store primitives instead of routing through historical diff-hunk snippet storage.
  - Preserve file-level replacement semantics by soft-deleting a file's live canonical rows before re-upserting chunk identities, letting unchanged content land as dedup and changed content land as replaced.
duration: 
verification_result: passed
completed_at: 2026-04-05T14:08:02.793Z
blocker_discovered: false
---

# T03: Added a dedicated canonical snapshot ingest path with fixture-proven replacement, dedup, exclusion, and historical-store separation semantics.

**Added a dedicated canonical snapshot ingest path with fixture-proven replacement, dedup, exclusion, and historical-store separation semantics.**

## What Happened

Built src/knowledge/canonical-code-ingest.ts as the dedicated runtime entry point for canonical snapshot ingest. The flow chunks each file with the canonical chunker, skips excluded paths with explicit observability, soft-deletes live canonical rows for the file, embeds each chunk, and upserts through the canonical store so stable chunk identity plus content hash yields inserted, replaced, or dedup outcomes. Added src/knowledge/canonical-code-ingest.test.ts with fixture-driven mock-store coverage proving first-ingest insertion, idempotent reruns after soft-delete, changed-content replacement, excluded-file skip behavior, explicit separation from historical diff-hunk semantics, and fail-fast embedding errors. Exported the ingest API from src/knowledge/index.ts. During verification one test initially expected the wrong exclusion reason precedence for a path matching both vendored and generated patterns; I corrected the test to match the actual local rule order rather than changing runtime behavior.

## Verification

Ran bun test ./src/knowledge/canonical-code-ingest.test.ts and bun run tsc --noEmit. The ingest suite passed 6/6 after correcting one test assertion about exclusion precedence, and the full TypeScript check passed with no errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/canonical-code-ingest.test.ts` | 0 | ✅ pass | 39ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 0ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/canonical-code-ingest.ts`
- `src/knowledge/canonical-code-ingest.test.ts`
- `src/knowledge/index.ts`
- `.gsd/milestones/M041/slices/S01/tasks/T03-SUMMARY.md`
