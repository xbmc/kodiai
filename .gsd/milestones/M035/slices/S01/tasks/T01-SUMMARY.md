---
id: T01
parent: S01
milestone: M035
key_files:
  - src/knowledge/runtime.ts
  - src/knowledge/embedding-repair.ts
  - src/knowledge/review-comment-store.ts
  - src/knowledge/code-snippet-store.ts
  - src/knowledge/wiki-store.ts
  - src/knowledge/memory-store.ts
  - src/knowledge/review-comment-embedding-sweep.ts
  - src/knowledge/issue-store.ts
  - src/knowledge/embedding-audit.ts
  - src/execution/config.ts
  - src/knowledge/cluster-matcher.ts
key_decisions:
  - Kept test files with 'voyage-code-3' unchanged — they represent historical/fixture data
  - wiki_pages corpus in EXPECTED_CORPUS_MODELS remains 'voyage-context-3' — uses a different model family
duration: 
verification_result: passed
completed_at: 2026-04-04T16:03:06.153Z
blocker_discovered: false
---

# T01: Changed DEFAULT_EMBEDDING_MODEL and NON_WIKI_TARGET_EMBEDDING_MODEL to "voyage-4" and swept all 25 hardcoded "voyage-code-3" literals from 11 non-test source files

**Changed DEFAULT_EMBEDDING_MODEL and NON_WIKI_TARGET_EMBEDDING_MODEL to "voyage-4" and swept all 25 hardcoded "voyage-code-3" literals from 11 non-test source files**

## What Happened

Surveyed all 11 target files with a single grep pass to confirm exact line context, then applied edits file by file. Changes covered: two exported constants (runtime.ts, embedding-repair.ts), the local EMBEDDING_MODEL constant in review-comment-embedding-sweep.ts, embeddingModel assignments and SQL IS DISTINCT FROM clauses in review-comment-store.ts (4), code-snippet-store.ts (2), wiki-store.ts (2), memory-store.ts (3), and issue-store.ts (5), the five non-wiki entries in EXPECTED_CORPUS_MODELS in embedding-audit.ts, three Zod schema defaults in config.ts, and a JSDoc comment in cluster-matcher.ts. Test files were intentionally left unchanged — they hold fixture/historical data representing the old model. The wiki_pages corpus in EXPECTED_CORPUS_MODELS was left as "voyage-context-3" since that corpus uses a different model family.

## Verification

grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '.test.ts' | grep -c '' printed 0. bun run tsc --noEmit exited 0 with no errors.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `grep -r 'voyage-code-3' src/ --include='*.ts' | grep -v '.test.ts' | grep -c '' || true` | 0 | ✅ pass | 500ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6600ms |

## Deviations

None.

## Known Issues

Existing DB rows still contain embedding_model = 'voyage-code-3'. This is expected — the repair sweep will migrate them. The audit map change ensures they are correctly flagged as model_mismatch on the next audit run.

## Files Created/Modified

- `src/knowledge/runtime.ts`
- `src/knowledge/embedding-repair.ts`
- `src/knowledge/review-comment-store.ts`
- `src/knowledge/code-snippet-store.ts`
- `src/knowledge/wiki-store.ts`
- `src/knowledge/memory-store.ts`
- `src/knowledge/review-comment-embedding-sweep.ts`
- `src/knowledge/issue-store.ts`
- `src/knowledge/embedding-audit.ts`
- `src/execution/config.ts`
- `src/knowledge/cluster-matcher.ts`
