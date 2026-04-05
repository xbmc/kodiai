---
id: T01
parent: S02
milestone: M040
key_files:
  - src/review-graph/query.ts
  - src/review-graph/query.test.ts
  - src/review-graph/types.ts
  - src/review-graph/store.ts
  - src/review-graph/store.test.ts
key_decisions:
  - Added a workspace-snapshot read API to the review-graph store for cross-file persisted graph queries.
  - Used confidence-weighted resolved edges plus bounded persisted heuristics instead of overstating current extractor certainty for cross-file impact.
duration: 
verification_result: passed
completed_at: 2026-04-05T10:17:36.389Z
blocker_discovered: false
---

# T01: Added persisted review-graph blast-radius queries that rank impacted files, probable dependents, and likely tests for C++ and Python fixtures.

**Added persisted review-graph blast-radius queries that rank impacted files, probable dependents, and likely tests for C++ and Python fixtures.**

## What Happened

Added src/review-graph/query.ts with a workspace-graph query surface that returns ranked impacted files, probable dependents, likely tests, seed symbols, and graph stats for changed paths. Extended the review-graph store contract with a workspace snapshot API and implemented it in the SQL store plus the in-memory test store so query execution can operate on persisted graph data cleanly. Combined direct graph edges with bounded persisted heuristics over import/include, callsite, and inferred test nodes to keep the output useful on current C++ and Python extractor fidelity while preserving explicit confidence and reasons. Added query tests that prove the new outputs surface graph-ranked dependents and likely tests for Python and C++ fixtures.

## Verification

Ran the task verification command from the plan: bun test ./src/review-graph/query.test.ts && bun run tsc --noEmit. The Python and C++ query tests passed, and the repository type-check completed successfully with the new store API and query types.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/review-graph/query.test.ts` | 0 | ✅ pass | 30ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6904ms |

## Deviations

Extended the store interface with listWorkspaceGraph() so blast-radius queries can read persisted graph state across files through the store abstraction. This was a local implementation adaptation required for a real cross-file query surface.

## Known Issues

Current blast-radius ranking still uses bounded heuristics for some cross-file C++ and Python impact links because extractor-level cross-file call resolution remains intentionally shallow. Confidence and reason strings are emitted explicitly to reflect that partial certainty.

## Files Created/Modified

- `src/review-graph/query.ts`
- `src/review-graph/query.test.ts`
- `src/review-graph/types.ts`
- `src/review-graph/store.ts`
- `src/review-graph/store.test.ts`
