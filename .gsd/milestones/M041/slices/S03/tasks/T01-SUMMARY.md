---
id: T01
parent: S03
milestone: M041
key_files:
  - src/knowledge/canonical-code-update.ts
  - src/knowledge/canonical-code-update.test.ts
  - src/knowledge/canonical-code-store.ts
  - src/knowledge/canonical-code-types.ts
  - src/knowledge/canonical-code-store.test.ts
  - src/knowledge/index.ts
  - .gsd/milestones/M041/slices/S03/tasks/T01-SUMMARY.md
key_decisions:
  - Kept steady-state selective refresh separate from backfill semantics by introducing a new canonical-code update module.
  - Extended the canonical code store with per-file live identity listing so unchanged chunk rows can be preserved without unnecessary rewrites.
duration: 
verification_result: passed
completed_at: 2026-04-05T14:43:38.925Z
blocker_discovered: false
---

# T01: Added a dedicated canonical-code selective refresh path that preserves unchanged rows, updates changed chunks, and reports steady-state counters.

**Added a dedicated canonical-code selective refresh path that preserves unchanged rows, updates changed chunks, and reports steady-state counters.**

## What Happened

Implemented src/knowledge/canonical-code-update.ts as the steady-state canonical corpus refresh path. It loads live chunk identities per touched file, compares new chunk hashes against existing rows, skips unchanged chunks without rewriting them, re-embeds only changed/new chunks, and removes stale file rows when identities disappear. Extended the canonical code store/type contract with listChunksForFile(), added store coverage, exported the new API, and wrote focused tests covering unchanged preservation, changed-chunk updates, stale-identity removal, excluded-file skips, and fail-open embedding handling.

## Verification

Ran the task-required verification command: bun test ./src/knowledge/canonical-code-update.test.ts && bun run tsc --noEmit. The selective update test file passed and the workspace typecheck passed after adding the new store method and exports.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/canonical-code-update.test.ts && bun run tsc --noEmit` | 0 | ✅ pass | 28ms |

## Deviations

None.

## Known Issues

The current store only supports file-level soft delete, so when a file drops one identity the updater soft-deletes all live rows for that file and restores surviving identities via upsert. Normal steady-state refresh still preserves unchanged rows when identities do not disappear.

## Files Created/Modified

- `src/knowledge/canonical-code-update.ts`
- `src/knowledge/canonical-code-update.test.ts`
- `src/knowledge/canonical-code-store.ts`
- `src/knowledge/canonical-code-types.ts`
- `src/knowledge/canonical-code-store.test.ts`
- `src/knowledge/index.ts`
- `.gsd/milestones/M041/slices/S03/tasks/T01-SUMMARY.md`
