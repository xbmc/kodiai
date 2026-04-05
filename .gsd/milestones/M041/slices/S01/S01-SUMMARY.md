---
id: S01
parent: M041
milestone: M041
provides:
  - Dedicated canonical current-code tables and store contract separate from historical diff-hunk snippet storage.
  - Canonical chunk identity and provenance types keyed by repo/owner/ref/file/chunk_type/symbol_name with commit_sha truthfulness.
  - Language-aware canonical chunking with auditable exclusion reasons and boundary decisions, including symbol-poor C++ block fallback.
  - A dedicated snapshot ingest path with per-file replacement, dedup, exclusion observability, and no writes to historical snippet tables.
  - Search and repair-ready store primitives (`searchByEmbedding`, `searchByFullText`, `listStaleChunks`, `updateEmbeddingsBatch`, `saveBackfillState`) for later slices.
requires:
  []
affects:
  - S02
  - S03
  - M038
key_files:
  - src/db/migrations/033-canonical-code-corpus.sql
  - src/knowledge/canonical-code-types.ts
  - src/knowledge/canonical-code-store.ts
  - src/knowledge/canonical-code-store.test.ts
  - src/knowledge/canonical-code-chunker.ts
  - src/knowledge/canonical-code-chunker.test.ts
  - src/knowledge/canonical-code-ingest.ts
  - src/knowledge/canonical-code-ingest.test.ts
  - src/knowledge/index.ts
  - .gsd/KNOWLEDGE.md
  - .gsd/PROJECT.md
key_decisions:
  - Keep canonical current-code storage in dedicated `canonical_code_chunks` / `canonical_corpus_backfill_state` tables rather than reusing historical `code_snippets` tables.
  - Enforce canonical chunk_type and backfill status invariants at the SQL schema boundary so the DB contract matches TypeScript types and documentation.
  - Keep canonical chunking in a dedicated module with auditable exclusion reasons and boundary decisions instead of extending diff-hunk chunker semantics.
  - For brace languages, use `block` fallback only when no symbol boundary exists; when symbols do exist, preserve symbol chunks plus an optional `module` remainder chunk.
  - Keep snapshot ingest as a dedicated orchestrator over canonical chunker + canonical store primitives; soft-delete live rows for a file before re-upserting chunk identities so outcomes are truthfully counted as inserted, replaced, or dedup.
patterns_established:
  - Use a dedicated canonical corpus module family (`canonical-code-*`) rather than extending historical diff-hunk storage or chunking paths when semantics differ.
  - Enforce documented enum-like invariants at the SQL layer with CHECK constraints so schema and TypeScript contracts cannot drift silently.
  - Model canonical upsert outcomes explicitly as inserted/replaced/dedup; this preserves truthful backfill accounting and avoids hiding dedup behind generic upsert behavior.
  - For file refresh, soft-delete a file's active canonical rows before re-upserting current chunks so removed symbols do not linger as live rows.
  - Expose exclusion reasons and boundary decisions as first-class observability data from chunkers rather than burying those decisions in logs only.
observability_surfaces:
  - Per-file ingest observability in `CanonicalCodeIngestFileResult`: excluded/exclusionReason/boundaryDecisions plus deleted/inserted/replaced/dedup counters.
  - Structured logger events in `ingestCanonicalCodeSnapshot()` for excluded files, completed file ingests, and whole-snapshot totals including repo/owner/ref/commit provenance.
  - Persisted `canonical_corpus_backfill_state` rows in the store contract for future resumable backfill progress, error, and cursor tracking.
  - Chunker observability surface in `CanonicalChunkResult.observability`, making exclusion reasons and boundary decisions auditable by tests and downstream tooling.
drill_down_paths:
  - .gsd/milestones/M041/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M041/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M041/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-05T14:12:16.445Z
blocker_discovered: false
---

# S01: Canonical Schema, Chunking, and Storage

**Delivered the canonical current-code substrate: dedicated schema and store, auditable chunking/exclusion rules, and a separate snapshot ingest path that persists current-code chunks with truthful repo/ref/commit provenance and replacement semantics.**

## What Happened

S01 established the canonical current-code substrate that M041 needs before any truthful unchanged-code retrieval can exist. T01 hardened the database and type contract: `src/db/migrations/033-canonical-code-corpus.sql` creates dedicated canonical corpus tables that are explicitly separate from historical diff-hunk storage, and the migration now enforces documented chunk/backfill invariants with SQL CHECK constraints so the schema boundary matches the TypeScript discriminated unions in `src/knowledge/canonical-code-types.ts`. `src/knowledge/canonical-code-store.ts` implements the separate store contract with explicit inserted/replaced/dedup outcomes, file-scoped soft-delete replacement semantics, semantic/full-text search helpers, stale-row repair helpers, and backfill-state persistence. T02 built `src/knowledge/canonical-code-chunker.ts` as a distinct current-code chunker rather than extending diff-hunk chunking. It adds auditable exclusion reasons for generated code, vendored paths, lockfiles, build output, and binary/assets; language-aware boundaries for Python, TypeScript, JavaScript, and C++; and an explicit symbol-poor C++ block fallback. The important semantic boundary is that brace-language files only fall back to `block` when no class/function boundary exists at all; otherwise the chunker preserves symbol chunks plus an optional module remainder, which future retrieval code can interpret cleanly. T03 then assembled these pieces into `src/knowledge/canonical-code-ingest.ts`, a dedicated snapshot ingest path that chunks each file, skips excluded files with explicit observability, soft-deletes that file's live canonical rows, embeds each chunk, and upserts through the canonical store so stable chunk identity plus content hash yields truthful inserted/replaced/dedup outcomes. Verification at slice close reran the full assembled slice gate: the canonical store tests passed 34/34, the canonical chunker tests passed 7/7, the ingest tests passed 6/6, and `bun run tsc --noEmit` exited 0. The resulting slice gives downstream work a trustworthy dedicated canonical corpus substrate: current-code chunks can now be persisted with repo/ref/commit provenance and without semantic contamination from historical diff-hunk tables.

## Verification

Reran the full slice verification contract at slice close: `bun test ./src/knowledge/canonical-code-store.test.ts` passed (34/34), `bun test ./src/knowledge/canonical-code-chunker.test.ts` passed (7/7), `bun test ./src/knowledge/canonical-code-ingest.test.ts` passed (6/6), and `bun run tsc --noEmit` exited 0. I also confirmed the planned observability/diagnostic surfaces exist in code: chunker results expose `excluded`, `exclusionReason`, and `boundaryDecisions`; ingest results/logs expose per-file and whole-snapshot inserted/replaced/dedup/deleted counters plus repo/ref/commit provenance; and the store exposes persisted `canonical_corpus_backfill_state` primitives for later slices.

## Requirements Advanced

- R036 — Established the dedicated canonical current-code schema, chunk identity/provenance contract, auditable chunking rules, and snapshot ingest path that R036 depends on before default-branch backfill and retrieval can be wired.
- R037 — Created the current-code substrate that M038 will later combine with M040 graph context to surface unchanged-code evidence for structurally grounded reviews.

## Requirements Validated

- R036 — Slice-close verification passed for the dedicated canonical current-code substrate: `bun test ./src/knowledge/canonical-code-store.test.ts`, `bun test ./src/knowledge/canonical-code-chunker.test.ts`, `bun test ./src/knowledge/canonical-code-ingest.test.ts`, and `bun run tsc --noEmit` all exited 0, proving current-code chunks can be chunked, ingested, and persisted with repo/ref/commit provenance in canonical tables separate from historical diff-hunk storage.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

The slice plan's task verification bullets listed `bun run tsc --noEmit` on T01 and implied it again in task summaries rather than at slice level; at slice close I reran the full slice verification set explicitly (`canonical-code-store`, `canonical-code-chunker`, `canonical-code-ingest`, and `tsc`) so the slice outcome is based on a single assembled verification pass. No code or artifact scope changed from plan.

## Known Limitations

This slice does not yet perform live repo backfill or review-time retrieval, and there is not yet an operational scheduler or runtime health surface beyond the typed/logged counters in the ingest/store APIs. Deleted-file reconciliation across a whole repo and stale/model-drift repair loops are deferred to later slices.

## Follow-ups

S02 should build the default-branch backfill job on top of `ingestCanonicalCodeSnapshot()` and `canonical_corpus_backfill_state`, then add retrieval wiring that queries `canonical_code_chunks` by semantic and full-text search with truthful repo/ref/commit provenance. S03 should add incremental changed-file refresh, stale/model-drift repair flows using `listStaleChunks()`/`updateEmbeddingsBatch()`, and explicit drift/audit verification over the same dedicated corpus.

## Files Created/Modified

- `src/db/migrations/033-canonical-code-corpus.sql` — Added the first dedicated canonical current-code corpus migration with canonical chunk/backfill tables, indexes, and SQL CHECK constraints for chunk_type invariants.
- `src/knowledge/canonical-code-types.ts` — Defined canonical chunk identity, provenance, search, and backfill-state types separate from historical diff-hunk snippet types.
- `src/knowledge/canonical-code-store.ts` — Implemented the dedicated canonical current-code store with inserted/replaced/dedup upsert semantics, file soft-delete replacement, search helpers, stale repair helpers, and backfill state persistence.
- `src/knowledge/canonical-code-store.test.ts` — Added focused canonical store tests covering insert/replacement/dedup, search, stale-row handling, and backfill state persistence.
- `src/knowledge/canonical-code-chunker.ts` — Implemented the dedicated canonical chunker with auditable exclusion reasons, language-aware boundaries, and block fallback only for symbol-poor files.
- `src/knowledge/canonical-code-chunker.test.ts` — Added chunker tests covering exclusions, Python/C++/TypeScript boundaries, symbol-poor C++ fallback, and stable content hashes.
- `src/knowledge/canonical-code-ingest.ts` — Implemented the dedicated canonical snapshot ingest orchestrator that chunks files, skips excluded paths, soft-deletes live rows per file, embeds chunks, and upserts into canonical tables without touching historical snippet storage.
- `src/knowledge/canonical-code-ingest.test.ts` — Added ingest tests proving insertion, idempotent reruns, replacement on changed content, exclusion observability, and historical-store separation semantics.
- `src/knowledge/index.ts` — Exported the canonical chunker and ingest APIs for downstream retrieval/backfill slices.
- `.gsd/KNOWLEDGE.md` — Recorded a future-useful chunking gotcha about block-vs-module fallback semantics for brace languages.
- `.gsd/PROJECT.md` — Refreshed project state to reflect completion of M041/S01 and the new canonical current-code substrate.
