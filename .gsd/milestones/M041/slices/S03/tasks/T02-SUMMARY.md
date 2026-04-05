---
id: T02
parent: S03
milestone: M041
key_files:
  - src/knowledge/embedding-audit.ts
  - src/knowledge/embedding-repair.ts
  - src/knowledge/runtime.ts
  - scripts/embedding-repair.ts
key_decisions:
  - Canonical code audit aggregates stale/missing/model-mismatch at the table level rather than per-repo, matching the operator view of a single corpus.
  - Canonical code repair uses a number→bigint ID bridge in the store adapter because the generic repair infrastructure uses number IDs while canonical_code_chunks uses bigint PKs.
  - Canonical code repair has no persistent checkpoint table; repair is always a fresh pass with listStaleChunks as the implicit state.
  - Added canonicalCodeStore to KnowledgeRuntime as a non-optional field since the store requires only a DB connection.
duration: 
verification_result: passed
completed_at: 2026-04-05T16:37:43.545Z
blocker_discovered: false
---

# T02: Extended embedding audit and repair to cover the canonical current-code corpus with stale/missing/model-mismatch detection and a per-repo×ref repair runner bridging bigint chunk IDs into the generic repair infrastructure.

**Extended embedding audit and repair to cover the canonical current-code corpus with stale/missing/model-mismatch detection and a per-repo×ref repair runner bridging bigint chunk IDs into the generic repair infrastructure.**

## What Happened

Added canonical_code to AUDITED_CORPORA and EXPECTED_CORPUS_MODELS in embedding-audit.ts with voyage-4 as the expected model. Added auditCanonicalCode() which queries canonical_code_chunks globally for total, missing_or_null, and stale counts plus a model-counts breakdown. Added canonical_code to EmbeddingRepairCorpus, NON_WIKI_REPAIR_CORPORA, and STALE_SUPPORTED_CORPORA in embedding-repair.ts. Added CANONICAL_CODE_TARGET_EMBEDDING_MODEL and createCanonicalCodeRepairStore() which wraps CanonicalCodeStore into the EmbeddingRepairStore interface via a number→bigint ID bridge. Added runCanonicalCodeEmbeddingRepair() as the high-level runner. Updated scripts/embedding-repair.ts with --repo and --ref CLI flags required for canonical_code corpus. Added canonicalCodeStore to KnowledgeRuntime and createKnowledgeRuntime in runtime.ts.

## Verification

Ran bun test ./scripts/embedding-audit.test.ts ./scripts/embedding-repair.test.ts — all 7 tests pass in ~59ms. Ran bun run tsc --noEmit — clean typecheck with no errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/embedding-audit.test.ts ./scripts/embedding-repair.test.ts` | 0 | ✅ pass | 59ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 800ms |

## Deviations

None.

## Known Issues

The canonical code repair has no persistent checkpoint; if a run is interrupted the operator must re-run the full command. The 2000-row CANONICAL_CODE_REPAIR_LIMIT bounds exposure per pass.

## Files Created/Modified

- `src/knowledge/embedding-audit.ts`
- `src/knowledge/embedding-repair.ts`
- `src/knowledge/runtime.ts`
- `scripts/embedding-repair.ts`
