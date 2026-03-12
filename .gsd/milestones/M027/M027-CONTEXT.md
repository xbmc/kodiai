# M027: Embedding Integrity & Timeout Hardening — Context

**Gathered:** 2026-03-11
**Status:** Queued — pending auto-mode execution.

## Project Description

Kodiai now depends on five persisted embedding-backed corpora plus query-time embedding generation: learning memories (`learning_memories`), PR review comments (`review_comments`), wiki pages (`wiki_pages`), code snippets (`code_snippets`), and issues/comments (`issues`, `issue_comments`). The codebase already has ingestion/backfill flows, retrieval wiring, a startup smoke test, and corpus-specific scripts, but it does not yet have a production-grade way to prove that embeddings are complete across all corpora, that query-time retrieval is actually using them correctly, or that repair/backfill jobs can finish reliably without timing out.

This milestone adds an end-to-end embedding integrity audit, production-safe repair tooling, and timeout root-cause fixes for the backfill/repair paths.

## Why This Milestone

Earlier milestones built the embedding system in pieces:
- M018 added PR review comments and wiki corpora
- M019 added code snippet embeddings
- M022 added issue corpus embeddings
- M025 added wiki-specific `voyage-context-3` routing and wiki re-embedding tooling

What is still missing is operational proof. The user wants to know whether embeddings actually exist for all stored content, whether retrieval still works end to end, and why repair/backfill scripts are timing out. Without this, the knowledge system can silently degrade: rows may exist without embeddings, corpora may drift, query embeddings may fail open to null, and repair jobs may never complete online.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Run a single audit and see which corpora are complete, degraded, or missing embeddings in production.
- Repair missing or stale embeddings online without downtime and confirm that retrieval is using the repaired data.

### Entry point / environment

- Entry point: production audit/repair CLI scripts plus the live Kodiai retrieval pipeline
- Environment: production-first, with local tests and fixtures backing the tooling
- Live dependencies involved: Azure PostgreSQL, Voyage AI embeddings API, GitHub App API, kodi.wiki export data, live retrieval code paths

## Completion Class

- Contract complete means: corpus completeness audits, repair tooling, and timeout-hardening logic exist with deterministic outputs and automated verification.
- Integration complete means: persisted corpus repair and query-time retrieval verification work across all five corpora using the real retrieval pipeline.
- Operational complete means: production-safe audit/repair flows run online, resume after interruption, and do not fail the milestone by timing out under normal expected dataset sizes.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A production-safe audit reports embedding completeness for learning memories, review comments, wiki pages, code snippets, and issues/comments, including counts of missing/null/stale/model-mismatched rows.
- At least one end-to-end verification path proves query-time embedding generation plus retrieval returns results from repaired corpora rather than only proving row presence.
- The timeout root cause in the backfill/repair path is identified and fixed, and the repaired script or workflow completes successfully on representative live data without downtime.

## Risks and Unknowns

- **Timeout source may differ by corpus** — wiki contextualized batch embedding, review comment backfill, and issue backfill have different API and batching behavior; the wrong fix could leave the real bottleneck untouched.
- **Silent fail-open behavior can hide integrity gaps** — current embedding providers return `null` on API failure, which preserves uptime but can mask missing embeddings unless audited explicitly.
- **Live repair can temporarily mix healthy and unhealthy rows** — online re-embedding and backfills must be resumable, observable, and safe against partial completion.
- **Model-specific correctness matters for wiki** — wiki uses `voyage-context-3` while other corpora use `voyage-code-3`; an audit must validate not just presence but correct model usage.

## Existing Codebase / Prior Art

- `src/knowledge/embeddings.ts` — shared and wiki-specific embedding providers, retry/timeout behavior, contextualized batch embedding helper.
- `src/knowledge/retrieval.ts` — unified cross-corpus retrieval pipeline where query-time embeddings are generated and corpus searches are combined.
- `src/index.ts` — production wiring for shared vs wiki embedding providers and the current startup smoke test.
- `scripts/backfill-review-comments.ts` — existing review comment backfill entry point.
- `scripts/backfill-issues.ts` — existing issue/comment backfill entry point.
- `scripts/wiki-embedding-backfill.ts` — existing wiki re-embedding repair script with page-level batching and fallback.
- `scripts/embedding-comparison.ts` — existing benchmark for comparing embedding-driven retrieval quality.
- `src/knowledge/review-comment-backfill.ts` — current per-chunk review comment embedding path used by backfill.
- `src/knowledge/wiki-sync.ts` and `src/knowledge/wiki-backfill.ts` — current wiki embedding creation paths.
- `src/knowledge/issue-backfill.ts` — current issue and issue-comment embedding creation paths.

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R019 — Production embedding audit covers all persisted corpora and reports integrity gaps.
- R020 — Repair tooling can restore missing/stale embeddings online without downtime.
- R021 — Query-time embedding and retrieval usage are verified end to end against repaired corpora.
- R022 — Timeout-prone embedding/backfill paths are root-caused and hardened.
- R023 — Model correctness is validated per corpus, especially wiki `voyage-context-3` vs other corpora `voyage-code-3`.
- R024 — Regression coverage prevents future embedding drift from going undetected.

## Scope

### In Scope

- Audit all persisted embedding corpora for null, missing, stale, and model-mismatch states.
- Verify query-time embedding generation and actual retrieval usage across the unified retrieval pipeline.
- Root-cause and fix timeout behavior in production-first repair/backfill scripts.
- Make repair paths resumable, rate-limited, observable, and online-safe.
- Add deterministic verification output suitable for operators and future milestones.
- Add tests and/or fixtures that lock in the repaired batching/timeout behavior.

### Out of Scope / Non-Goals

- New retrieval features unrelated to integrity or timeout hardening.
- Marketplace, product, or UI work.
- Deep architectural rewrite of the knowledge system.
- Replacing Voyage AI or changing the fundamental vector database stack.

## Technical Constraints

- Repairs must be online-safe and assume no downtime maintenance window.
- Audit results must distinguish row presence from usable retrieval behavior.
- Fail-open runtime behavior can remain, but integrity gaps must become observable and repairable.
- Wiki corpus validation must respect its separate embedding model and contextualized embedding path.
- Production-first scope means any heavy repair logic needs bounded batching, resume semantics, and clear progress reporting.

## Integration Points

- Azure PostgreSQL / pgvector — source of truth for persisted embeddings and integrity checks.
- Voyage AI — document/query embedding generation and the likely timeout surface for repair jobs.
- GitHub App API — required for review comment and issue backfill/repair workflows.
- kodi.wiki ingestion pipeline — required for wiki re-embedding validation and repair.
- Unified retrieval pipeline (`createRetriever`) — must prove repaired embeddings are actually used at query time.

## Open Questions

- Exact dominant timeout root cause is still unknown — initial investigation should determine whether the primary bottleneck is Voyage API timeout, batch sizing, rate limiting, database write strategy, or a script control-flow issue.
- Whether one audit command should repair opportunistically or remain read-only by default — bias is toward read-only audit plus explicit repair mode.
