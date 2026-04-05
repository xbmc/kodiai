---
id: T02
parent: S02
milestone: M041
key_files:
  - src/knowledge/canonical-code-retrieval.ts
  - src/knowledge/canonical-code-retrieval.test.ts
  - src/knowledge/retrieval.ts
  - src/knowledge/cross-corpus-rrf.ts
  - src/knowledge/index.ts
  - .gsd/milestones/M041/slices/S02/tasks/T02-SUMMARY.md
key_decisions:
  - Modeled canonical current-code retrieval as a new `canonical_code` source instead of collapsing it into the existing historical `code` corpus so provenance survives prompt packing and downstream audits.
  - Reused the existing fail-open retrieval helper pattern for canonical semantic search and integrated it directly into the main retrieval fan-out.
duration: 
verification_result: passed
completed_at: 2026-04-05T14:23:01.157Z
blocker_discovered: false
---

# T02: Added canonical current-code semantic retrieval as a distinct provenance-rich corpus in the unified retrieval pipeline.

**Added canonical current-code semantic retrieval as a distinct provenance-rich corpus in the unified retrieval pipeline.**

## What Happened

Implemented a dedicated canonical code retrieval helper backed by the canonical code store, returning semantic matches with canonical ref, commit SHA, file path, line range, chunk type, symbol name, content hash, and embedding model. Integrated those matches into the existing retrieval orchestrator as a new `canonical_code` unified source rather than folding them into the historical `code` corpus, preserving corpus boundaries and provenance for downstream review prompts. Updated unified retrieval provenance to expose `canonicalCodeCount`, ensured canonical hits contribute source-labeled entries to the assembled context window, extended the unified source discriminator, and exported the new helper. Added focused tests covering the standalone helper plus retriever orchestration and fail-open behavior.

## Verification

Ran `bun test ./src/knowledge/canonical-code-retrieval.test.ts` and all five canonical retrieval tests passed, covering helper mapping, null-embedding skip, store fail-open behavior, retriever integration, and canonical fail-open preservation of other corpora. Also ran `bun run tsc --noEmit --pretty false` to verify the new `canonical_code` source discriminator and provenance additions compile cleanly across the codebase.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/canonical-code-retrieval.test.ts` | 0 | ✅ pass | 21ms |
| 2 | `bun run tsc --noEmit --pretty false` | 0 | ✅ pass | 1000ms |

## Deviations

Used only the canonical store's semantic search path and did not add canonical BM25 orchestration because this task's contract was specifically to add canonical semantic retrieval with provenance.

## Known Issues

Unified canonical retrieval currently passes `main` as the canonical ref inside the orchestration path. Repositories whose default branch differs will need a follow-up caller wiring change to pass the resolved canonical ref explicitly.

## Files Created/Modified

- `src/knowledge/canonical-code-retrieval.ts`
- `src/knowledge/canonical-code-retrieval.test.ts`
- `src/knowledge/retrieval.ts`
- `src/knowledge/cross-corpus-rrf.ts`
- `src/knowledge/index.ts`
- `.gsd/milestones/M041/slices/S02/tasks/T02-SUMMARY.md`
