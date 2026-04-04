---
depends_on: [M035]
---

# M041: Canonical Repo-Code Corpus

**Gathered:** 2026-04-04
**Status:** Queued — pending auto-mode execution
**Depends on:** M035

## Project Description

Kodiai already embeds code, but the existing corpus is not a canonical snapshot of the repository's current code. `embedDiffHunks()` in `src/handlers/review.ts` persists historical changed hunks tied to PR occurrences. That is useful for review history and precedent retrieval, but it does not answer a different question: **what unchanged code is currently true at the default branch head, and which parts of that code are semantically relevant to this review?**

This milestone builds that missing substrate: a canonical repo-code corpus for current code at HEAD/default branch, chunked at function/class/module granularity, stored with commit/ref provenance, and maintained via one-time backfill + incremental merge updates + scheduled audit/repair. It is deliberately separate from M040's graph substrate. The graph answers structural impact; this corpus answers semantic relevance for unchanged code. M038 should consume both.

## Language Priority

**C++ and Python are first-class target languages.** These are the dominant languages in the Kodi codebase. Chunking strategy, symbol extraction, file filtering rules, and embedding parameters must be designed and verified for C++ and Python first.

TypeScript/JavaScript are **present but secondary** — they should work and can be included from day one, but are not the primary tuning or verification target.

**Practical implication:** C++ and Python symbol extraction (function definitions, class definitions, method bodies) must be tested against real-world Kodi-style C++ and Python files. The chunking fallback strategy for symbol-poor files (e.g. large `.cpp` files with preprocessor complexity) must be explicitly handled.

## Why This Milestone

A lot of high-value review context lives outside the diff:

- the unchanged caller that now violates an invariant
- the sibling implementation that shows the intended pattern
- the helper whose semantics make a local change risky
- the downstream consumer that a signature change will break

Graph expansion alone can over-recall. Semantic retrieval alone can miss true structural impact. The useful shape is to keep them separate and combine them later:

- **M040** narrows candidate regions structurally
- **M041** ranks current unchanged code semantically within or near those regions
- **M038** consumes both to build better review-time context

## User-Visible Outcome

### When this milestone is complete, the user can:

- Rely on Kodiai having a canonical, auditable current-code corpus for the default branch for C++ and Python repos
- Use downstream review features to retrieve semantically relevant unchanged code with clear provenance
- Trust that the corpus stays fresh through event-driven updates and audit/repair

### Entry point / environment

- Entry point: background backfill/update pipeline plus merge-driven incremental update path
- Environment: production
- Live dependencies involved: GitHub repo/workspace access, PostgreSQL/pgvector, Voyage embeddings

## Completion Class

- Contract complete means: Kodiai can persist canonical current-code chunks for a repo's default branch with commit/ref provenance, query them by semantic similarity, and keep them fresh with incremental updates plus audit/repair; C++ and Python verified
- Integration complete means: a C++ or Python repo can be backfilled once, updated on merge for changed files only, and queried for semantically relevant unchanged code
- Operational complete means: unchanged files are not re-embedded unnecessarily, model/version drift is auditable, repair paths are fail-open and bounded

## Final Integrated Acceptance

- A one-time backfill of a production-like C++ or Python repo stores canonical code chunks for current HEAD with `commit_sha`, `file_path`, chunk identity, embedding model, and audit metadata
- A merge/update flow re-embeds only changed files or changed chunks; unchanged rows remain untouched
- An audit/repair pass can detect stale/missing rows and repair them without full-repo re-embedding
- Retrieval for a review-style query returns current unchanged C++ or Python code from the canonical corpus rather than historical PR hunks

## Risks and Unknowns

- **Chunk identity stability** — symbol names can move or split across refactors. Need a chunk identity stable enough for incremental replacement
- **C++ chunking difficulty** — C++ files with templates, macros, and preprocessor blocks can have weak or ambiguous symbol boundaries. Explicit fallback behavior (fixed-size chunking) required for these cases
- **Merge/update trigger shape** — if merge-driven updates are missing or delayed, freshness degrades. The audit/repair path must catch drift without becoming a hidden full rebuild
- **Corpus bloat** — embedding whole files or generated artifacts creates noise and cost. Filtering rules for generated/vendor/build outputs must be explicit and must cover Kodi-specific patterns (auto-generated `.cpp`, vendored libraries)
- **Overlap with existing historical snippet corpus** — storage and retrieval APIs must keep historical and canonical corpora separate

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — verified `embedDiffHunks()` persists PR diff hunks after review; this is historical review context, not canonical current code
- `src/knowledge/code-snippet-store.ts` — existing snippet persistence patterns; inform but do not collapse with new canonical corpus
- `src/knowledge/code-snippet-retrieval.ts` — existing retrieval patterns; useful contrast for keeping historical vs. canonical corpora separate
- `src/knowledge/embedding-audit.ts` — established audit pattern for persisted embedding corpora
- `src/knowledge/embedding-repair.ts` — established repair/backfill pattern for stale or missing embeddings
- `src/db/migrations/009-code-snippets.sql` — prior code-snippet persistence schema; evidence that the current corpus is historical changed hunks, not HEAD snapshots

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- New scope — this milestone introduces a canonical current-code corpus beyond today's historical diff-hunk embeddings

## Scope

### In Scope

- New canonical corpus storage for current default-branch code chunks with repo, canonical ref, commit SHA, file path, language, chunk type, chunk identity, content hash, embedding model, and audit timestamps
- Chunking strategy: function-level, class-level, and small module-level fallback; **C++ and Python chunking designed and verified first**
- Explicit handling of C++ symbol-poor cases (template-heavy files, preprocessor blocks) with fixed-size fallback chunking
- One-time backfill pipeline for a repo's default branch
- Incremental merge/update path that refreshes only changed files/chunks
- Scheduled audit/repair sweep for stale, missing, or model-mismatched rows
- Retrieval interface for semantically querying canonical current-code chunks with provenance-preserving results
- Filtering rules for generated files, vendored code, lockfiles, and build outputs — covering Kodi-specific patterns
- Deterministic verification for C++ and Python backfill correctness and incremental-update selectivity

### Out of Scope / Non-Goals

- Re-embedding the entire repository on a daily schedule
- Replacing the existing historical diff-hunk embedding corpus
- Direct prompt integration (M038 is the consumer)
- Whole-file embeddings as the default unit
- Tuning TypeScript/JavaScript chunking to the same depth as C++ and Python in this milestone

## Technical Constraints

- Must preserve truthful provenance: every row needs ref/commit metadata
- Must be selective: changed files/chunks only for normal updates
- Must be fail-open: failures cannot block reviews
- Must reuse Postgres/pgvector
- C++ and Python chunking must be verified before TypeScript/JavaScript is accepted as a milestone completion blocker

## Integration Points

- `src/handlers/review.ts` — existing diff-hunk path to contrast with and keep separate
- `src/knowledge/code-snippet-store.ts` / `src/knowledge/code-snippet-retrieval.ts` — reuse patterns carefully
- `src/knowledge/embedding-audit.ts` / `src/knowledge/embedding-repair.ts` — audit and repair patterns
- `src/jobs/workspace.ts` — workspace/repo access for backfill and incremental update jobs
- `src/db/migrations/` — new canonical corpus tables and bookkeeping

## Open Questions

- **Chunk identity shape** — key replacement by `(repo, ref, file_path, symbol_name, chunk_type)` plus content hash, or stronger symbol identity scheme from the start?
- **Update trigger** — merge webhooks, post-merge background jobs, or commit SHA delta sweep per repo?
