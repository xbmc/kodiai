---
id: S02
parent: M041
milestone: M041
provides:
  - A resumable default-branch canonical backfill primitive that can seed or resume canonical current-code storage for a repo snapshot.
  - A provenance-rich canonical semantic retrieval surface returning canonical ref, commit SHA, file path, line span, chunk type, symbol name, content hash, and embedding model.
  - A unified retriever contract that keeps `canonical_code` and historical `snippet` evidence distinct while exposing both in a single retrieval result.
  - A deterministic verifier (`verify:m041:s02`) that future slices can reuse as a regression gate when modifying canonical corpus orchestration.
requires:
  - slice: S01
    provides: Dedicated canonical schema, canonical chunk identity/provenance types, auditable chunking rules, and canonical ingest primitives.
affects:
  - M041/S03
  - M038
key_files:
  - src/knowledge/canonical-code-backfill.ts
  - src/knowledge/canonical-code-ingest.ts
  - src/knowledge/canonical-code-retrieval.ts
  - src/knowledge/retrieval.ts
  - scripts/verify-m041-s02.ts
  - scripts/verify-m041-s02.test.ts
  - package.json
  - .gsd/KNOWLEDGE.md
  - .gsd/PROJECT.md
key_decisions:
  - Reuse the existing GitHub App installation-context and workspace clone path to resolve the canonical default-branch snapshot rather than creating a separate repo-access path.
  - Treat canonical backfill and ingest as fail-open at file/chunk granularity by recording warnings/counters instead of aborting on single-item embedding or store failures.
  - Model canonical current-code retrieval as a distinct `canonical_code` unified source so provenance survives prompt packing and downstream audits.
  - Extend unified retrieval to accept a caller-supplied canonicalRef and verify it against a non-`main` default-branch fixture to prevent regressions back to a hard-coded `main` assumption.
patterns_established:
  - Default-branch-aware workflows should reuse the existing workspace + installation-context path and thread the resolved canonical ref explicitly through all downstream retrieval calls rather than re-resolving or hard-coding branch names.
  - Canonical current-code evidence must remain a separate `canonical_code` corpus in unified retrieval so downstream prompt packing and audits can distinguish current snapshot context from historical diff-hunk context.
  - Backfill/ingest jobs in this codebase should fail open at item granularity, persist progress/state, and expose bounded counters rather than treating one file/chunk failure as a run-fatal condition.
  - Proof harnesses should use deterministic production-like fixtures and stable check IDs/status codes so slice claims are machine-verifiable, not summary-only.
observability_surfaces:
  - Backfill result/status counters: `filesDone`, `chunksDone`, `chunksFailed`, warning count, canonical ref, and commit SHA in `backfillCanonicalCodeSnapshot(...)` output.
  - Durable resume cursor and state in `canonical_corpus_backfill_state`, including `last_file_path`, status, commit SHA, and aggregate progress.
  - Unified retrieval provenance counters now include `canonicalCodeCount` and preserve `snippetCount`, making corpus contribution visible to downstream callers.
  - `verify:m041:s02` machine-verifiable harness emits four stable check IDs with explicit status codes and details for deterministic regression proof.
drill_down_paths:
  - .gsd/milestones/M041/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M041/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M041/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T14:35:30.780Z
blocker_discovered: false
---

# S02: Default-Branch Backfill and Semantic Retrieval

**Completed default-branch canonical code backfill and provenance-rich semantic retrieval, with deterministic proof that canonical current-code retrieval works on non-`main` default branches and stays separate from historical diff-hunk evidence.**

## What Happened

S02 turned the canonical current-code substrate from M041/S01 into a usable workflow. T01 added a resumable one-time default-branch backfill pipeline that resolves the repo’s actual default branch through the existing workspace/GitHub-App access path, chunks eligible files, stores canonical snapshot rows, and persists progress in `canonical_corpus_backfill_state`. The pipeline is intentionally fail-open at file and chunk granularity: embedding or store failures increment warnings/counters and preserve partial progress instead of aborting the whole repo backfill. T02 then added provenance-rich semantic retrieval over those canonical rows and integrated it into the unified retriever as a new `canonical_code` corpus, preserving separation from historical diff-hunk snippets rather than flattening both into one generic code source. T03 completed the slice with a deterministic end-to-end proof harness that creates a non-`main` fixture repo, runs the real backfill path, exercises unified retrieval with both canonical rows and historical snippet fixtures, and proves four things: canonical rows were persisted, retrieval returns canonical current-code evidence, historical snippet evidence remains distinct, and the resolved default branch (`trunk` in the fixture) propagates end to end. During slice closure, the planned commands for tests/verifier all passed but `bun run tsc --noEmit` exposed type regressions inside the new proof harness tests. Those were fixed by making nested fixture overrides structurally complete and by making the in-memory snippet store satisfy the full `CodeSnippetStore` contract. After that repair, the full slice gate passed cleanly.

## Verification

Executed the full slice gate after fixing proof-harness type regressions discovered during closure: `bun run tsc --noEmit`, `bun test ./src/knowledge/canonical-code-backfill.test.ts`, `bun test ./src/knowledge/canonical-code-retrieval.test.ts`, `bun test ./scripts/verify-m041-s02.test.ts`, and `bun run verify:m041:s02 -- --json` all exited 0. The verifier reported overallPassed=true with four passing checks: canonical snapshot rows persisted, canonical current-code retrieval surfaced, corpus separation preserved, and non-main default branch propagation respected.

## Requirements Advanced

- R036 — Completed the workflow half of the canonical current-code requirement by proving one-time default-branch backfill plus provenance-preserving semantic retrieval over canonical snapshot rows.
- R037 — Made the canonical current-code corpus concretely consumable by downstream review-time systems that need truthful unchanged-code evidence, reducing the remaining work needed for structural-impact review integration.

## Requirements Validated

- R036 — Slice-level verification passed: `bun test ./src/knowledge/canonical-code-backfill.test.ts`, `bun test ./src/knowledge/canonical-code-retrieval.test.ts`, `bun test ./scripts/verify-m041-s02.test.ts`, `bun run verify:m041:s02 -- --json`, and `bun run tsc --noEmit` all exited 0. The proof harness reported four passing checks for canonical persistence, canonical current-code retrieval evidence, corpus separation, and non-main default-branch propagation.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

Task summaries initially reported green verification, but slice-level closure caught TypeScript regressions in `scripts/verify-m041-s02.test.ts` and the verifier snippet-store fixture shape. The closer repaired those test/type issues and reran the full slice gate before completion. No product-scope deviation from the slice plan remained.

## Known Limitations

The verifier proves retrieval surfaces canonical current-code rows with preserved corpus separation, but it does not require canonical results to globally outrank every historical snippet. The backfill path is resumable and bounded via `maxFiles`, but it still walks the eligible workspace tree rather than offering richer batching/throttling controls. No runtime observability surface beyond structured counters/warnings was added in this slice.

## Follow-ups

M041/S03 should build incremental refresh and audit/repair on top of the persisted `canonical_corpus_backfill_state` cursor and the now-stable `canonical_code` retrieval contract. M038 can now consume `canonical_code` evidence as truthful unchanged-code context, but may still need policy decisions about how strongly canonical hits should outrank historical snippet hits in the final prompt packing.

## Files Created/Modified

- `src/knowledge/canonical-code-backfill.ts` — Implements resumable default-branch canonical backfill with progress state, fail-open per-file/per-chunk handling, and explicit counters.
- `src/knowledge/canonical-code-backfill.test.ts` — Adds unit coverage for happy-path backfill, fail-open embedding degradation, and resume behavior.
- `src/knowledge/canonical-code-ingest.ts` — Makes canonical ingest fail open on missing/throwing embeddings per chunk instead of aborting the snapshot ingest.
- `src/knowledge/canonical-code-ingest.test.ts` — Adds regression coverage for fail-open ingest semantics used by backfill.
- `src/knowledge/canonical-code-retrieval.ts` — Implements provenance-rich canonical semantic retrieval mapped to a distinct `canonical_code` corpus.
- `src/knowledge/canonical-code-retrieval.test.ts` — Adds focused tests for canonical retrieval mapping, null-embedding skip, store fail-open behavior, and unified retriever integration.
- `src/knowledge/retrieval.ts` — Threads caller-supplied canonicalRef through unified retrieval so default-branch retrieval is not hard-coded to `main`, and preserves canonical/snippet corpus boundaries in unified results.
- `scripts/verify-m041-s02.ts` — Adds deterministic end-to-end proof harness for canonical persistence, current-code retrieval evidence, corpus separation, and non-main default-branch propagation.
- `scripts/verify-m041-s02.test.ts` — Locks the proof-harness contract, JSON/text output, failure signaling, and full nested fixture override shapes required by tsc.
- `package.json` — Registers the runnable `verify:m041:s02` proof entrypoint used by slice-level verification.
- `.gsd/KNOWLEDGE.md` — Records the M041/S02 testing gotcha about full-shape nested fixture overrides in proof-harness tests.
- `.gsd/PROJECT.md` — Refreshes project state to mark M041/S02 complete and describe the new canonical backfill + retrieval capability.
