# Feature Landscape

**Domain:** Intelligent retrieval enhancements, specialized review pipelines, and CI failure analysis for AI code review
**Researched:** 2026-02-25
**Milestone:** v0.19 Intelligent Retrieval Enhancements
**Confidence:** HIGH (all four features verified against existing codebase, real user feedback, and issue #42 requirements)

## Existing Foundation (Already Built)

These features are production and form the base for v0.19:

| Existing Capability | Module | How v0.19 Extends It |
|---------------------|--------|---------------------|
| Language-aware re-ranking (boost same-language, penalize cross-language) | `knowledge/retrieval-rerank.ts` | Schema extension: store `language` column on learning_memories so boosting works at DB level, not just post-hoc |
| File-path language classification (20 languages) | `execution/diff-analysis.ts` | `classifyFileLanguage()` is the source of truth; new schema column derives from this at write time |
| Snippet anchoring (file-level grounding for retrieval results) | `knowledge/retrieval-snippets.ts` | Hunk-level embedding replaces file-level anchoring with sub-function granularity |
| Three-stage dep bump detection (detect, extract, classify) | `lib/dep-bump-detector.ts` | `[depends]` PR detection extends Stage 1 with Kodi-specific title patterns |
| Security advisory + changelog enrichment | `lib/dep-bump-enrichment.ts` | Deep review pipeline wraps existing enrichment with impact analysis and hash verification |
| Merge confidence scoring | `lib/merge-confidence.ts` | Deep review adds structured output with changelog highlights and action items |
| CI status MCP server (get_ci_status, get_workflow_run_details) | `execution/mcp/ci-status-server.ts` | CI failure recognition adds scope-diff correlation to determine unrelatedness |
| Unified cross-corpus retrieval (code + review + wiki) | `knowledge/retrieval.ts` | Language boosting and snippet embedding improve result quality within existing pipeline |
| Hybrid BM25+vector search with RRF merging | `knowledge/hybrid-search.ts` | Language column enables language-filtered BM25 queries for precision |

## Table Stakes

Features users expect given the existing system. Missing these = regression or gap in capability promise.

### 1. Language-Aware Retrieval Boosting (Schema Extension)

| Aspect | Detail |
|--------|--------|
| **Feature** | Add `language` column to `learning_memories` table; use it for database-level filtering and boosted retrieval ranking |
| **Why Expected** | `retrieval-rerank.ts` already boosts by language, but it re-derives language from `filePath` at query time. Storing language at write time enables DB-level WHERE clauses and index-assisted filtering |
| **Complexity** | Low |
| **Dependencies** | Migration script (ALTER TABLE), `classifyFileLanguage()` from diff-analysis.ts, backfill existing rows |
| **User Experience** | No visible UX change. Retrieval results become more relevant -- same-language code examples surface more often. Provenance logging shows language filter was applied |
| **Confidence** | HIGH -- schema is under our control, `classifyFileLanguage()` is well-tested, rerank logic exists |

**What changes:**
- New PostgreSQL migration: `ALTER TABLE learning_memories ADD COLUMN language TEXT`
- Write path: derive language via `classifyFileLanguage(record.filePath)` before INSERT
- Backfill script: UPDATE existing rows with derived language
- Retrieval: add optional `WHERE language = ANY($prLanguages)` to vector search query
- Re-ranking: `retrieval-rerank.ts` can use stored language instead of re-deriving
- BM25: add language as filter parameter to `searchByFullText`

### 2. `[depends]` PR Deep Review Pipeline

| Aspect | Detail |
|--------|--------|
| **Feature** | Specialized, in-depth review pipeline for Kodi-style dependency bump PRs (e.g., `[depends] Bump zlib 1.3.2`, `[Windows] Refresh fstrcmp 0.7`) |
| **Why Expected** | Existing dep-bump detection only handles Dependabot/Renovate title patterns. Kodi uses manual `[depends]` prefix convention for C/C++ library bumps that compile from source. These PRs have hidden blast radius and need MORE review, not less |
| **Complexity** | High |
| **Dependencies** | `dep-bump-detector.ts` (Stage 1 extension), `dep-bump-enrichment.ts` (changelog/security), `review-prompt.ts` (prompt section), CI status server |
| **User Experience** | When Kodiai detects a `[depends]` PR, the review includes a structured deep-review section: version diff summary, upstream changelog highlights relevant to Kodi, impact assessment (which Kodi files consume this dependency), hash/URL verification, patch validation, and explicit action items. The review is thorough, not lighter |
| **Confidence** | HIGH -- issue #42 has concrete examples (xbmc/xbmc#27900, #27870), existing enrichment pipeline provides foundation |

**What this involves:**
1. **Detection extension** -- Add `[depends]` and `[Windows]` title prefix patterns to Stage 1 detection (currently only Dependabot/Renovate). These PRs are NOT bot PRs, so the two-signal requirement needs adjustment: title pattern alone is sufficient for `[depends]`
2. **Upstream analysis** -- For C/C++ libraries compiled from source, fetch changelog/release notes from upstream project (not package registry). Need to resolve library name to upstream repo (e.g., "zlib" -> madler/zlib on GitHub)
3. **Impact assessment** -- Grep workspace for `#include` / usage of the dependency's headers. Cross-reference with breaking changes from changelog
4. **Build config validation** -- Check CMakeLists.txt / build system changes: hash changes, URL changes, removed/added patches, version string updates
5. **Structured output** -- Dedicated prompt section with: version diff, changelog highlights, impact analysis, hash verification checklist, action items
6. **Integration** -- Wire into existing `handlePullRequest` flow alongside current dep-bump pipeline

**Kodi-specific context:**
- `[depends]` PRs update C/C++ libraries that Kodi compiles from source (not package managers)
- Patches are often applied on top of upstream (patch files in `tools/depends/target/`)
- Hash/URL changes in build recipes must be verified against upstream releases
- Build system uses CMake; dependency configs live in `tools/depends/`

### 3. Unrelated CI Failure Recognition

| Aspect | Detail |
|--------|--------|
| **Feature** | Detect when CI failures are unrelated to the PR's changed files/scope; annotate with reasoning so maintainers can merge confidently |
| **Why Expected** | Direct user feedback: garbear on xbmc/xbmc#27884 said "We can merge with unrelated failures. The failure is a gradle problem with parallel builds for Android." Maintainers waste time investigating CI failures that have nothing to do with their PR |
| **Complexity** | Medium-High |
| **Dependencies** | `ci-status-server.ts` (existing MCP tool for CI data), `diff-analysis.ts` (changed files), GitHub Actions API |
| **User Experience** | When CI fails, Kodiai adds a comment (or section in review) noting which failures appear unrelated, with reasoning. Example: "CI failure in `build-android` appears unrelated to this PR -- the failing step `gradle assemble` is a known flaky build issue, and none of the 5 files changed in this PR touch Android build configuration." Does NOT block approval on unrelated failures |
| **Confidence** | MEDIUM-HIGH -- the MCP server already fetches CI data; the challenge is the heuristic for determining unrelatedness |

**How unrelatedness is determined:**
1. **File scope correlation** -- Compare PR's changed files against the failing workflow's trigger paths and test directories. If no overlap, likely unrelated
2. **Historical flakiness** -- Track which workflows fail frequently across different PRs. If `build-android` fails on 30% of PRs regardless of content, it is likely flaky
3. **Step-level analysis** -- Use `get_workflow_run_details` to identify the specific failed step. Map step names to file domains (e.g., "gradle" -> Android, "cmake" -> C++ build)
4. **Failure message pattern matching** -- Known patterns like "timeout", "network error", "parallel build race" indicate infrastructure rather than code issues
5. **Cross-PR comparison** -- If the same workflow failed on the base branch (main) recently, the failure predates this PR

## Differentiators

Features that set the product apart. Not expected, but valuable.

### 4. Code Snippet Embedding (Hunk-Level Granularity)

| Aspect | Detail |
|--------|--------|
| **Feature** | Embed diff hunks at sub-function granularity for more precise semantic retrieval, rather than file-level or finding-level memories |
| **Why Expected** | NOT expected -- explicitly marked as "exploratory" in issue #42. Current retrieval works at finding-level (one embedding per `findingText`). Hunk-level embedding would capture the actual code context around findings |
| **Complexity** | High |
| **Dependencies** | Diff parser (hunk extraction), embedding provider (Voyage AI), new table or extended schema, retrieval pipeline changes |
| **User Experience** | Retrieval results include actual code snippets from past reviews, not just finding descriptions. When reviewing a PR that touches similar code to a past PR, Kodiai can cite the specific code pattern from the prior review |
| **Confidence** | MEDIUM -- this is exploratory. Research supports sub-function chunking for better retrieval, but the cost/benefit for Kodiai's use case needs validation |

**What this involves:**
1. **Hunk extraction** -- Parse unified diff format to extract individual hunks with surrounding context lines
2. **Context enrichment** -- Use Tree-sitter or simple heuristics to expand hunks to encompass the full function/method boundary
3. **New storage** -- Likely a `code_snippets` table with columns: repo, pr_number, file_path, start_line, end_line, hunk_text, language, embedding
4. **Embedding pipeline** -- Embed each hunk at write time (during review comment backfill or on PR review completion)
5. **Retrieval integration** -- Add as fourth corpus in the unified retrieval pipeline (alongside code, review, wiki)
6. **Budget management** -- Hunks are small, so many embeddings per PR. Need token/cost budgeting

**Research context:**
- ContextCRBench (2025) demonstrates hunk-level quality assessment works well for code review
- Greptile's research confirms per-function chunking outperforms per-file for code search
- Tree-sitter AST parsing provides reliable function boundary detection across languages

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Auto-merge on CI pass | Kodiai is a reviewer, not a merge bot. Auto-merge crosses trust boundary | Comment with merge confidence assessment; let humans merge |
| CI failure auto-retry | Retrying workflows is an operational action, not a review action | Annotate as unrelated; let maintainers decide to retry |
| Dependency auto-update PRs | Kodiai reviews PRs, it does not create dependency bump PRs | Review Dependabot/Renovate PRs that already exist |
| Full AST parsing for all languages | Tree-sitter for 20+ languages is heavy infra. Hunk extraction does not require full AST | Use regex-based function boundary detection, or limit AST to C/C++ for Kodi |
| Real-time CI monitoring | Watching CI in real-time adds webhook complexity and cost | Check CI status at review time or on explicit request |
| Package vulnerability database sync | Maintaining our own advisory database duplicates GitHub Advisory Database | Query GitHub Advisory API on-demand (existing pattern) |
| Language-specific linter integration | Running linters is CI's job, not Kodiai's | Detect when linter CI steps fail; reference linter results in review |
| Hunk embedding for all past PRs | Backfilling embeddings for all historical hunks is expensive and speculative | Start with new PRs only; backfill selectively if value is proven |

## Feature Dependencies

```
Language-Aware Boosting (schema)
  -> No dependencies on other new features
  -> Improves retrieval quality for all other features

[depends] PR Deep Review
  -> Extends dep-bump-detector.ts Stage 1
  -> Uses dep-bump-enrichment.ts (changelog, security)
  -> Uses ci-status-server.ts (for build verification)
  -> Benefits from Language-Aware Boosting (C/C++ context retrieval)

CI Failure Recognition
  -> Uses ci-status-server.ts (get_ci_status, get_workflow_run_details)
  -> Uses diff-analysis.ts (changed file list)
  -> Independent of other new features
  -> Complements [depends] deep review (build failures in dep bumps)

Code Snippet Embedding (exploratory)
  -> Depends on Language-Aware Boosting schema pattern (adds language column)
  -> New table, new corpus in retrieval pipeline
  -> Independent of [depends] and CI recognition
  -> Highest risk, lowest priority
```

## MVP Recommendation

**Phase 1: Foundation (low risk, immediate value)**
1. Language-aware boosting schema extension -- migration, backfill, retrieval integration
2. CI failure recognition -- scope correlation heuristic, comment annotation

**Phase 2: Deep Review Pipeline (high value, medium risk)**
3. `[depends]` PR deep review -- detection extension, impact analysis, structured output

**Phase 3: Exploratory (high risk, deferred)**
4. Code snippet embedding -- exploratory, validate approach before committing

**Rationale:**
- Language boosting is a schema change that improves everything else and has zero UX risk
- CI failure recognition is a direct response to user feedback with clear acceptance criteria
- `[depends]` deep review is the highest-value feature but also the most complex; it benefits from language boosting being in place first (C/C++ retrieval)
- Code snippet embedding is explicitly exploratory in the issue and should not block the other three

**Defer:**
- Code snippet embedding: Mark as exploratory spike. Build a prototype for one language (C++) on a small corpus to validate retrieval quality improvement before investing in full pipeline

## Complexity Assessment

| Feature | Complexity | LOC Estimate | Test Estimate | Risk |
|---------|-----------|-------------|--------------|------|
| Language-aware boosting (schema) | Low | ~200 | ~100 | Low -- migration + backfill, well-understood pattern |
| CI failure recognition | Medium | ~500 | ~300 | Medium -- heuristic accuracy is the main challenge |
| `[depends]` deep review | High | ~800 | ~400 | Medium -- Kodi-specific patterns need careful testing |
| Code snippet embedding | High | ~1000+ | ~500+ | High -- new corpus, new table, embedding cost unknown |

## Sources

- [Issue #42: v0.19 Intelligent Retrieval Enhancements](https://github.com/xbmc/kodiai/issues/42)
- [xbmc/xbmc#27900: [depends] Bump zlib 1.3.2](https://github.com/xbmc/xbmc/pull/27900) -- example `[depends]` PR
- [xbmc/xbmc#27870: [Windows] Refresh fstrcmp 0.7](https://github.com/xbmc/xbmc/pull/27870) -- example platform-scoped dep bump
- [xbmc/xbmc#27884: Unrelated CI failure feedback from garbear](https://github.com/xbmc/xbmc/pull/27884) -- user feedback driving CI recognition
- [xbmc/xbmc#22546: [depends][Android] Add base dependencies setup for libdovi](https://github.com/xbmc/xbmc/pull/22546) -- example of platform-scoped `[depends]`
- [ContextCRBench: Benchmarking LLMs for Fine-Grained Code Review](https://arxiv.org/abs/2511.07017) -- hunk-level quality assessment research
- [Greptile: Codebases are uniquely hard to search semantically](https://www.greptile.com/blog/semantic-codebase-search) -- per-function chunking rationale
- [Understanding and Detecting Flaky Builds in GitHub Actions](https://www.arxiv.org/pdf/2602.02307) -- flaky test detection research
- [Oppia: If CI checks fail on your PR](https://github.com/oppia/oppia/wiki/If-CI-checks-fail-on-your-PR) -- file-scope heuristic for unrelated failures
- Codebase verification: `src/knowledge/retrieval-rerank.ts`, `src/lib/dep-bump-detector.ts`, `src/execution/mcp/ci-status-server.ts`, `src/knowledge/retrieval.ts`, `src/knowledge/memory-store.ts`
