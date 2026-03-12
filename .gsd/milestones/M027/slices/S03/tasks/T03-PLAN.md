---
estimated_steps: 5
estimated_files: 6
---

# T03: Add the remaining corpus adapters and store repair selectors

**Slice:** S03 — Unified Online Repair for Remaining Corpora
**Milestone:** M027

## Description

Extend the shared engine across `issues`, `issue_comments`, `learning_memories`, and `code_snippets` so all remaining persisted corpora can be repaired through one resumable operator contract instead of a mix of bespoke scripts and missing paths.

## Steps

1. Extend `src/knowledge/embedding-repair.ts` with corpus adapters for `issues`, `issue_comments`, `learning_memories`, and `code_snippets`, reusing existing text builders where they already define embedding semantics.
2. Add repair-specific selectors and batched update helpers to `src/knowledge/issue-store.ts`, preserving the fact that `issues` and `issue_comments` do not support `stale` semantics.
3. Add repair-specific selectors and batched update helpers to `src/knowledge/memory-store.ts`, including null/stale/wrong-model coverage for `learning_memories`.
4. Add repair-specific selectors and batched update helpers to `src/knowledge/code-snippet-store.ts`, limited to persisted snippet rows with `embedded_text` and without pretending occurrences can recreate missing snippets.
5. Make `src/knowledge/embedding-repair.test.ts` pass for all five corpus adapters, including empty-corpus, wrong-model, and dry-run/no-op cases.

## Must-Haves

- [ ] `issues` and `issue_comments` reuse persisted-text builders without inventing fake `stale` support.
- [ ] `learning_memories` and `code_snippets` include null/stale/model-mismatch repair coverage consistent with S01 audit semantics.
- [ ] `code_snippets` repair remains limited to existing snippet rows; occurrence-only data is not misrepresented as repairable text.

## Verification

- `bun test src/knowledge/embedding-repair.test.ts`
- The engine test suite passes for all five corpora, including model-mismatch selection, empty-corpus no-op behavior, and persisted-text-only repair semantics.

## Observability Impact

- Signals added/changed: Shared repair reports now expose truthful corpus-specific counts and failure summaries across all remaining corpora.
- How a future agent inspects this: One engine/test surface now shows which corpus supports stale repair, which cursor shape it uses, and how no-op/healthy cases are reported.
- Failure state exposed: Adapter-specific failure classes and corpus names remain visible without having to read disparate backfill script logs.

## Inputs

- `src/knowledge/issue-comment-chunker.ts` — canonical `buildIssueEmbeddingText()` and `buildCommentEmbeddingText()` helpers that define issue/issue-comment embedding text.
- S03 research summary — the remaining corpora must repair from persisted row content only and preserve audit-model semantics instead of flattening schema differences.

## Expected Output

- `src/knowledge/embedding-repair.ts` — extended shared engine with all remaining corpus adapters wired.
- `src/knowledge/issue-store.ts` — repair selectors and batched updates for `issues` and `issue_comments`.
- `src/knowledge/memory-store.ts` / `src/knowledge/code-snippet-store.ts` — repair selectors and batched updates for memory and snippet corpora.
