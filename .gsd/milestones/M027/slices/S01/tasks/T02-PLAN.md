---
estimated_steps: 4
estimated_files: 5
---

# T02: Implement the read-only embedding audit surface

**Slice:** S01 — Live Audit & Retriever Verification Surface
**Milestone:** M027

## Description

Build the shared audit logic and operator command that report persisted embedding integrity and model correctness across all six corpora without mutating production data.

## Steps

1. Implement `src/knowledge/embedding-audit.ts` with schema-aware queries and a shared result model for `learning_memories`, `review_comments`, `wiki_pages`, `code_snippets`, `issues`, and `issue_comments`.
2. Encode corpus-specific rules: wiki expects `voyage-context-3`, all other corpora expect `voyage-code-3`, `issues`/`issue_comments` expose `stale` as unsupported-by-schema, and `code_snippets` include occurrence coverage diagnostics.
3. Add `scripts/embedding-audit.ts` and a package alias that render human output from the same JSON model while staying read-only.
4. Make the new tests pass and verify the command prints deterministic JSON for automation.

## Must-Haves

- [ ] The audit emits stable per-corpus fields: `total`, `missing_or_null`, `stale`, `model_mismatch`, `expected_model`, `actual_models`, `status`, and `severity`.
- [ ] No audit code mutates rows, backfills embeddings, or hides unsupported schema dimensions behind invented counts.
- [ ] Human-readable output is a rendering of the same JSON contract, not a separate hand-built code path.

## Verification

- `bun test src/knowledge/embedding-audit.test.ts scripts/embedding-audit.test.ts`
- `bun run audit:embeddings --json`

## Observability Impact

- Signals added/changed: Stable corpus-level health/status records with explicit severity and model mismatch visibility.
- How a future agent inspects this: Run `bun run audit:embeddings --json` and compare per-corpus fields rather than spelunking tables manually.
- Failure state exposed: Missing embeddings, wrong models, unsupported stale semantics, and snippet occurrence gaps are surfaced as machine-readable statuses.

## Inputs

- `src/knowledge/memory-store.ts`, `src/knowledge/review-comment-store.ts`, `src/knowledge/wiki-store.ts`, `src/knowledge/code-snippet-store.ts`, `src/knowledge/issue-store.ts` — current persisted schema behavior and integrity seams.
- `T01-PLAN.md` — locked audit contract and CLI expectations.

## Expected Output

- `src/knowledge/embedding-audit.ts` — shared read-only audit logic and result types.
- `scripts/embedding-audit.ts` — operator entrypoint for JSON and human-readable audit output.
- `package.json` — `audit:embeddings` script alias.
