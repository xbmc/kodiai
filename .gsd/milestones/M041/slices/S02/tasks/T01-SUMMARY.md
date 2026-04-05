---
id: T01
parent: S02
milestone: M041
key_files:
  - src/knowledge/canonical-code-backfill.ts
  - src/knowledge/canonical-code-backfill.test.ts
  - src/knowledge/canonical-code-ingest.ts
  - src/knowledge/canonical-code-ingest.test.ts
  - src/knowledge/index.ts
  - .gsd/milestones/M041/slices/S02/tasks/T01-SUMMARY.md
key_decisions:
  - Reused the existing GitHub App installation-context and workspace clone path to resolve the canonical default-branch snapshot instead of introducing a separate repo-access mechanism.
  - Made canonical backfill and ingest fail open at file/chunk granularity by recording warnings and counters rather than aborting the entire run on single-item embedding/store failures.
duration: 
verification_result: passed
completed_at: 2026-04-05T14:17:53.666Z
blocker_discovered: false
---

# T01: Added a resumable default-branch canonical code backfill pipeline with fail-open per-file/per-chunk handling and explicit progress counters.

**Added a resumable default-branch canonical code backfill pipeline with fail-open per-file/per-chunk handling and explicit progress counters.**

## What Happened

Implemented `src/knowledge/canonical-code-backfill.ts` to resolve the repository default branch through the existing GitHub App installation-context path, clone that branch with the existing workspace manager, determine the canonical HEAD SHA, enumerate eligible files, and write canonical chunks into the canonical corpus store. The job persists progress in `canonical_corpus_backfill_state`, resumes from `last_file_path` when the stored commit SHA still matches, and records structured warnings plus done/skipped/failed counters so single-file read, embedding, or store failures do not abort the full run. I also updated `src/knowledge/canonical-code-ingest.ts` so missing or throwing embedding generation fails open per chunk instead of crashing the full ingest request, and exported the new backfill module from `src/knowledge/index.ts`. Added tests covering happy-path backfill, fail-open embedding degradation, resume behavior, and the adjusted ingest failure semantics.

## Verification

Ran `bun test ./src/knowledge/canonical-code-backfill.test.ts`, `bun test ./src/knowledge/canonical-code-ingest.test.ts`, and `bun run tsc --noEmit`. The first verification attempt exposed a resume run-id bug and type-shape mismatches for the new failed counters; after fixing those targeted issues, the full verification command passed cleanly.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/canonical-code-backfill.test.ts && bun test ./src/knowledge/canonical-code-ingest.test.ts && bun run tsc --noEmit` | 0 | ✅ pass | 3000ms |

## Deviations

Updated `src/knowledge/canonical-code-ingest.ts` and its tests in addition to the planned new backfill files so the shared canonical ingest primitive satisfies the slice’s fail-open requirement.

## Known Issues

The backfill currently uses a full recursive workspace walk with optional `maxFiles` capping and persisted resume state, but it does not yet expose richer batching/throttling controls beyond that cursor. None.

## Files Created/Modified

- `src/knowledge/canonical-code-backfill.ts`
- `src/knowledge/canonical-code-backfill.test.ts`
- `src/knowledge/canonical-code-ingest.ts`
- `src/knowledge/canonical-code-ingest.test.ts`
- `src/knowledge/index.ts`
- `.gsd/milestones/M041/slices/S02/tasks/T01-SUMMARY.md`
