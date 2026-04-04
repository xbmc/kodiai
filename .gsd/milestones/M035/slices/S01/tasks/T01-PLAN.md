---
estimated_steps: 14
estimated_files: 11
skills_used: []
---

# T01: Update model constants and sweep hardcoded voyage-code-3 strings from non-test source

Change the two exported model constants to "voyage-4" and fix every remaining hardcoded "voyage-code-3" literal in non-test source files. The embedding-audit.ts EXPECTED_CORPUS_MODELS map must also be updated — after this change, all existing DB rows (still on voyage-code-3) will show as model_mismatch in the next audit run. This is expected; the repair sweep will fix them.

Steps:
1. In src/knowledge/runtime.ts line 18: change DEFAULT_EMBEDDING_MODEL = "voyage-code-3" to "voyage-4".
2. In src/knowledge/embedding-repair.ts line 145: change NON_WIKI_TARGET_EMBEDDING_MODEL = "voyage-code-3" to "voyage-4".
3. In src/knowledge/review-comment-store.ts: replace all "voyage-code-3" literals (lines 171, 226, 412, 448) with "voyage-4" or import+use NON_WIKI_TARGET_EMBEDDING_MODEL from embedding-repair.ts where appropriate.
4. In src/knowledge/code-snippet-store.ts: same pattern as review-comment-store.ts (lines 274, 318).
5. In src/knowledge/wiki-store.ts (lines 114, 158): change "voyage-code-3" fallback defaults to "voyage-4".
6. In src/knowledge/memory-store.ts (lines 79, 292, 338): change "voyage-code-3" literals to "voyage-4".
7. In src/knowledge/review-comment-embedding-sweep.ts line 5: change EMBEDDING_MODEL = "voyage-code-3" to "voyage-4".
8. In src/knowledge/issue-store.ts (lines 188, 345, 416, 436, 479): change "voyage-code-3" literals to "voyage-4".
9. In src/knowledge/embedding-audit.ts (lines 20-25): update EXPECTED_CORPUS_MODELS map — change all non-wiki corpora entries (learning_memories, review_comments, code_snippets, issues, issue_comments) from "voyage-code-3" to "voyage-4".
10. In src/execution/config.ts (lines 244, 247, 327): update Zod schema defaults from "voyage-code-3" to "voyage-4".
11. In src/knowledge/cluster-matcher.ts line 36: update JSDoc comment text (no runtime impact).
12. Run the verification grep and confirm zero hits.

## Inputs

- ``src/knowledge/runtime.ts``
- ``src/knowledge/embedding-repair.ts``
- ``src/knowledge/review-comment-store.ts``
- ``src/knowledge/code-snippet-store.ts``
- ``src/knowledge/wiki-store.ts``
- ``src/knowledge/memory-store.ts``
- ``src/knowledge/review-comment-embedding-sweep.ts``
- ``src/knowledge/issue-store.ts``
- ``src/knowledge/embedding-audit.ts``
- ``src/execution/config.ts``
- ``src/knowledge/cluster-matcher.ts``

## Expected Output

- ``src/knowledge/runtime.ts` — DEFAULT_EMBEDDING_MODEL = "voyage-4"`
- ``src/knowledge/embedding-repair.ts` — NON_WIKI_TARGET_EMBEDDING_MODEL = "voyage-4"`
- ``src/knowledge/review-comment-store.ts` — no "voyage-code-3" literals`
- ``src/knowledge/code-snippet-store.ts` — no "voyage-code-3" literals`
- ``src/knowledge/wiki-store.ts` — no "voyage-code-3" literals`
- ``src/knowledge/memory-store.ts` — no "voyage-code-3" literals`
- ``src/knowledge/review-comment-embedding-sweep.ts` — no "voyage-code-3" literals`
- ``src/knowledge/issue-store.ts` — no "voyage-code-3" literals`
- ``src/knowledge/embedding-audit.ts` — EXPECTED_CORPUS_MODELS non-wiki entries all "voyage-4"`
- ``src/execution/config.ts` — Zod schema defaults updated to "voyage-4"`

## Verification

grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '\.test\.ts' | grep -c '' || true  # must print 0
