# S03: Unified Online Repair for Remaining Corpora

**Goal:** Extend the bounded, resumable repair pattern from wiki pages to `learning_memories`, `review_comments`, `code_snippets`, `issues`, and `issue_comments` so operators can repair degraded persisted rows online from local Postgres content instead of falling back to ad hoc backfills or GitHub re-fetch loops.
**Demo:** An operator can run one shared repair command for any remaining corpus, inspect durable progress/status state, resume safely after interruption, repair the live `review_comments` degradation, and get truthful no-op/model-drift reporting for the other remaining corpora through the same stable contract.

## Must-Haves

- A shared non-wiki repair engine selects degraded persisted rows using the S01 audit semantics (`embedding IS NULL`, wrong `embedding_model`, and `stale=true` only for corpora that support it) while keeping all non-wiki writes pinned to `voyage-code-3`.
- Durable repair state is persisted separately from ingestion sync state in a generic `embedding_repair_state` surface that records corpus-scoped cursor/progress, last failure metadata, and resume readiness after every bounded batch.
- `review_comments`, `issues`, `issue_comments`, `learning_memories`, and `code_snippets` each get an explicit adapter that rebuilds embedding text from persisted row data only; normal repair flow must not depend on GitHub API fetches.
- Operators get one JSON-first `repair:embeddings` command with `--corpus`, `--status`, `--resume`, `--dry-run`, and stable human-readable rendering from the same envelope used by `--json`.
- Slice proof includes regression coverage plus operational evidence: the live `review_comments` gap is repaired with durable status output, follow-up audit truthfully improves for that corpus, and the remaining corpora report safe no-op/healthy status through the shared contract.

## Proof Level

- This slice proves: operational
- Real runtime required: yes
- Human/UAT required: no

## Verification

- `bun test src/knowledge/embedding-repair.test.ts scripts/embedding-repair.test.ts scripts/verify-m027-s03.test.ts`
- `bun run repair:embeddings -- --corpus review_comments --json`
- `bun run repair:embeddings -- --corpus review_comments --status --json`
- `bun run repair:embeddings -- --corpus review_comments --resume --json`
- `bun run repair:embeddings -- --corpus issues --dry-run --json`
- `bun run verify:m027:s03 -- --corpus review_comments --json`
- `bun run audit:embeddings --json`

## Observability / Diagnostics

- Runtime signals: structured per-batch repair progress with `run_id`, `corpus`, `repair_key`, `target_model`, `last_row_id`/cursor, `processed`, `repaired`, `skipped`, `failed`, `failure_class`, `resumed`, and `dry_run` fields.
- Inspection surfaces: `bun run repair:embeddings [--corpus <name>] [--status|--resume|--dry-run] [--json]`, `bun run verify:m027:s03 -- --corpus review_comments --json`, `bun run audit:embeddings --json`, and the persisted `embedding_repair_state` rows in Postgres.
- Failure visibility: last processed cursor, cumulative counts, last failure class/message, updated timestamp, resume availability, and corpus-specific failure summary remain inspectable after process exit.
- Redaction constraints: never log raw embeddings, API keys, or full persisted document/comment bodies; diagnostics should use corpus names, row identifiers, counts, model names, and summarized failure metadata only.

## Integration Closure

- Upstream surfaces consumed: `src/knowledge/runtime.ts`, `src/knowledge/embedding-audit.ts`, `src/knowledge/review-comment-store.ts`, `src/knowledge/issue-store.ts`, `src/knowledge/memory-store.ts`, `src/knowledge/code-snippet-store.ts`, `src/knowledge/issue-comment-chunker.ts`, and the S02 wiki repair contract in `src/knowledge/wiki-embedding-repair.ts` / `scripts/wiki-embedding-repair.ts`.
- New wiring introduced in this slice: a shared row-based repair engine plus generic repair-state persistence for non-wiki corpora, per-corpus persisted-text adapters, a unified `repair:embeddings` operator CLI, and an S03 proof harness that preserves repair/status/audit evidence.
- What remains before the milestone is truly usable end-to-end: S04 must run the integrated production-style proof across audit, all repair surfaces, and the live retriever path; `issue_comments` still remain audited/repairable but not part of the current retriever unless later milestone work changes that boundary.

## Tasks

- [x] **T01: Lock shared non-wiki repair contracts with failing tests** `est:45m`
  - Why: S03 needs the multi-corpus repair contract, status envelope, and proof-harness expectations fixed before implementation broadens across five stores and one shared CLI.
  - Files: `src/knowledge/embedding-repair.test.ts`, `scripts/embedding-repair.test.ts`, `scripts/verify-m027-s03.test.ts`
  - Do: Add failing tests for corpus-specific degraded-row selection, stale-support differences, durable resume/status fields, dry-run behavior, per-corpus adapter text shaping, CLI JSON/human output, and the S03 proof harness evidence/check-ID envelope.
  - Verify: `bun test src/knowledge/embedding-repair.test.ts scripts/embedding-repair.test.ts scripts/verify-m027-s03.test.ts`
  - Done when: The new tests fail only because the shared engine/CLI/proof harness do not exist yet, and the failures name the exact S03 contracts instead of placeholders.
- [x] **T02: Build the shared repair engine, generic state table, and live review-comment path** `est:1h15m`
  - Why: `review_comments` is the only currently degraded remaining corpus, so S03 should first ship the shared bounded/resumable engine on the corpus that immediately closes live risk.
  - Files: `src/knowledge/embedding-repair.ts`, `src/db/migrations/029-embedding-repair-state.sql`, `src/db/migrations/029-embedding-repair-state.down.sql`, `src/knowledge/review-comment-store.ts`, `src/knowledge/review-comment-types.ts`, `src/knowledge/embedding-repair.test.ts`
  - Do: Implement a generic row-based repair engine with corpus-scoped cursor state, batch limits, delay/retry controls, durable progress persistence, and a `review_comments` adapter that repairs from stored `chunk_text` while selecting null/stale/wrong-model rows from Postgres.
  - Verify: `bun test src/knowledge/embedding-repair.test.ts`
  - Done when: The shared engine persists resumable repair state outside sync tables, `review_comments` passes the contract tests, and the implementation exposes stable cursor/count/failure fields for later CLI use.
- [x] **T03: Add the remaining corpus adapters and store repair selectors** `est:1h15m`
  - Why: S03 only closes R020 if every remaining persisted corpus can be repaired through the same bounded engine instead of leaving four corpora on ad hoc or manual paths.
  - Files: `src/knowledge/embedding-repair.ts`, `src/knowledge/issue-store.ts`, `src/knowledge/memory-store.ts`, `src/knowledge/code-snippet-store.ts`, `src/knowledge/issue-comment-chunker.ts`, `src/knowledge/embedding-repair.test.ts`
  - Do: Extend the engine with adapters/selectors for `issues`, `issue_comments`, `learning_memories`, and `code_snippets`, reusing existing embedding-text builders and honoring schema differences like unsupported `stale` on issue tables and code-snippet repair limited to persisted snippet rows.
  - Verify: `bun test src/knowledge/embedding-repair.test.ts`
  - Done when: All five non-wiki corpora are repairable through one engine contract, no adapter depends on GitHub API fetches, and the test suite covers null/stale/model-mismatch plus empty-corpus/no-op behavior.
- [x] **T04: Ship the unified repair CLI, status surface, and operator docs** `est:1h`
  - Why: The engine is not operationally useful until operators can invoke it consistently, inspect durable state, and separate read-only status/dry-run from actual mutation.
  - Files: `scripts/embedding-repair.ts`, `package.json`, `docs/operations/embedding-integrity.md`, `scripts/embedding-repair.test.ts`
  - Do: Add `repair:embeddings` with `--corpus`, `--status`, `--resume`, `--dry-run`, and `--json`; render human output from the same report envelope as JSON; document corpus coverage, status inspection, and the difference between historical backfill scripts and the new row-local repair command.
  - Verify: `bun test scripts/embedding-repair.test.ts && bun run repair:embeddings -- --corpus issues --dry-run --json`
  - Done when: Operators have one stable repair/status command for all five corpora, dry-run/read-only separation is explicit, and docs show how to inspect persisted repair state without reading raw logs.
- [x] **T05: Add repeatable slice proof and execute live review-comment repair evidence** `est:1h`
  - Why: S03 owns the remaining all-corpus repair story, so it must prove the live degraded corpus can be repaired now while keeping truthful evidence for future runs and no-op corpora.
  - Files: `scripts/verify-m027-s03.ts`, `scripts/verify-m027-s03.test.ts`, `docs/operations/embedding-integrity.md`, `.gsd/REQUIREMENTS.md`
  - Do: Implement an S03 proof harness that runs live `review_comments` repair plus persisted status and post-run audit checks, preserves raw evidence envelopes with stable check IDs, and includes safe no-op verification for at least one currently empty/healthy remaining corpus through the same CLI contract.
  - Verify: `bun test scripts/verify-m027-s03.test.ts && bun run verify:m027:s03 -- --corpus review_comments --json`
  - Done when: The harness returns machine-checkable success with preserved repair/status/audit evidence, live `review_comments` degradation is reduced or cleared without timeout-class failure, and requirements/proof docs can point at repeatable commands instead of one-off shell transcripts.

## Files Likely Touched

- `src/knowledge/embedding-repair.ts`
- `src/knowledge/review-comment-store.ts`
- `src/knowledge/issue-store.ts`
- `src/knowledge/memory-store.ts`
- `src/knowledge/code-snippet-store.ts`
- `src/db/migrations/029-embedding-repair-state.sql`
- `src/db/migrations/029-embedding-repair-state.down.sql`
- `scripts/embedding-repair.ts`
- `scripts/verify-m027-s03.ts`
- `docs/operations/embedding-integrity.md`
- `package.json`
- `.gsd/REQUIREMENTS.md`
