# Pitfalls Research

**Domain:** Adding language-aware retrieval boosting, hunk-level code snippet embedding, [depends] PR deep review pipeline, and CI failure recognition to an existing AI code review bot (Kodiai v0.19)
**Researched:** 2026-02-25
**Confidence:** HIGH (all pitfalls verified against codebase: `src/knowledge/retrieval.ts` unified pipeline, `src/knowledge/retrieval-rerank.ts` existing language reranking, `src/knowledge/cross-corpus-rrf.ts` RRF engine, `src/lib/dep-bump-detector.ts` three-stage pipeline, `src/execution/mcp/ci-status-server.ts` existing CI MCP tool, `src/db/migrations/001-initial-schema.sql` learning_memories schema, `src/db/migrations/005-review-comments.sql` review_comments schema)

---

## Critical Pitfalls

Mistakes that cause incorrect reviews, lost output, data corruption, or require architectural rework.

---

### Pitfall 1: Language Boosting Applied Twice -- Legacy Rerank + Unified Pipeline Double-Boost

**What goes wrong:**
The existing retrieval pipeline in `retrieval.ts` already applies `rerankByLanguage()` to learning memory results (line 360-362) before they enter the unified cross-corpus RRF pipeline. If language-aware boosting is also added to the unified pipeline (e.g., boosting `UnifiedRetrievalChunk` items by language match), code-corpus results will receive language adjustment twice: once via `adjustedDistance` multiplier in the legacy path, and again via a new boost in the unified path. This double-application inflates language-matched code results while leaving review and wiki results with only a single boost, distorting the cross-corpus balance.

**Why it happens:**
The `createRetriever()` function maintains a dual pipeline for backward compatibility -- legacy (findings + snippetAnchors) and unified (unifiedResults + contextWindow). The legacy pipeline's `rerankByLanguage()` modifies distances before the results flow into `memoryToUnified()` at line 408. A developer adding language boosting to the unified pipeline would not realize the code-corpus entries have already been adjusted.

**How to avoid:**
Choose one of two clean strategies:
1. **Unified-only boosting:** Remove `rerankByLanguage()` from the legacy path and apply language boosting only in the unified pipeline after RRF scoring (step 6e in retrieval.ts). This requires updating the legacy `findings` output to use raw distances, which may affect downstream consumers.
2. **Legacy-only boosting (no change to unified):** Keep `rerankByLanguage()` where it is and do NOT add language boosting to the unified pipeline. Instead, extend the schema to store `language` on `learning_memories`, `review_comments`, and `wiki_pages` rows, and pass language metadata through `UnifiedRetrievalChunk.metadata` for the prompt to use contextually.

Strategy 2 is safer because it avoids changing existing behavior while adding language metadata for downstream use.

**Warning signs:**
- Code-corpus results consistently dominate the top of `unifiedResults` when the PR touches a common language (TypeScript/Python).
- The `SOURCE_WEIGHTS` multipliers in `retrieval.ts` stop having the intended effect because language boost overwhelms them.
- Review and wiki results that should be relevant get pushed below the topK cutoff.

**Phase to address:**
Language-aware retrieval boosting phase -- must decide on strategy 1 vs 2 before any implementation.

---

### Pitfall 2: Hunk-Level Embedding Explodes Storage and Voyage API Costs

**What goes wrong:**
The existing `learning_memories` table stores one embedding per finding (one row per review finding per outcome). The existing `review_comments` table stores one embedding per chunk (sliding window: 1024 tokens, 256 overlap). Moving to hunk-level code snippet embedding means generating embeddings for every changed hunk in every reviewed PR. A typical PR touches 5-15 files with 2-5 hunks each, producing 10-75 embeddings per review. Over 18 months of xbmc/xbmc PRs (the existing backfill covered 18 months of review comments), hunk-level embedding would produce 50,000-200,000 additional rows with 1024-dimensional vectors.

Each Voyage AI embedding call costs ~$0.10 per million tokens. With 75 hunks per PR averaging 200 tokens each, that is 15,000 tokens per PR. At 50 PRs/month, that is 750K tokens/month for hunks alone. Combined with the existing learning memory and review comment embeddings, this pushes monthly Voyage costs 2-3x higher.

Storage impact: each 1024-dim float32 vector is 4KB. 200K hunks = 800MB of vector data in PostgreSQL, requiring HNSW index rebuild and potentially degrading query performance.

**Why it happens:**
Hunk granularity is appealing because it enables sub-function matching ("this specific pattern in this specific loop was flagged before"). But hunks are inherently ephemeral -- they represent a snapshot of a diff, not a stable code pattern. Most hunk embeddings become semantically useless within weeks as the code evolves.

**How to avoid:**
- Gate hunk embedding behind PR significance: only embed hunks from PRs where findings were actually produced (not all reviewed PRs). This reduces volume by 60-80% since most clean PRs generate zero findings.
- Set a staleness TTL: auto-mark hunk embeddings as stale after 90 days (the code they reference has likely changed). Use the existing `stale` boolean pattern from `learning_memories`.
- Use a smaller embedding model for hunks. If Voyage AI supports a lower-dimensional model (512-dim), use it for hunks while keeping 1024-dim for learning memories and review comments.
- Budget-cap Voyage calls per month. Track embedding token usage in `telemetry_events` and skip hunk embedding when the monthly budget is exceeded. This is a graceful degradation, not a failure.
- Consider this feature exploratory. Ship it behind a feature flag in `.kodiai.yml` (`retrieval.hunkEmbedding.enabled: false` by default) and measure actual retrieval quality improvement before enabling by default.

**Warning signs:**
- `learning_memories` table row count growing faster than 10x the number of reviewed PRs.
- Voyage API costs increasing without corresponding improvement in retrieval relevance.
- HNSW index build time exceeding 30 seconds on migration.
- Vector search latency on `learning_memories` increasing beyond 100ms (currently well under this).

**Phase to address:**
Code snippet embedding phase -- must include storage budget analysis and feature flag before implementation.

---

### Pitfall 3: [depends] PR Detection Collides with Existing Three-Stage Detection

**What goes wrong:**
The existing `dep-bump-detector.ts` uses a two-signal requirement (title pattern + label/branch/sender) to classify dependency bump PRs. The `[depends]` PR deep review pipeline adds a new detection surface: PR titles or branch names containing `[depends]` or similar markers. If the `[depends]` detector runs independently of the existing `detectDepBump()`, the same PR could trigger both pipelines. A Dependabot PR titled "Bump lodash from 4.17.20 to 4.17.21" would trigger the existing dep-bump path (light review + merge confidence), while a manual PR titled "[depends] Upgrade lodash to address CVE-2021-23337" would trigger the deep review path. But what about a PR that matches both? The system would produce two review comments with potentially conflicting advice.

**Why it happens:**
The existing dep-bump pipeline is optimized for automated bot PRs (Dependabot/Renovate) with predictable title formats. The `[depends]` deep review is designed for human-authored dependency PRs that need deeper analysis (changelog parsing, breaking change detection, impact assessment). These are different use cases, but they share the same domain (dependency changes) and the same PR surface.

**How to avoid:**
- Make the pipelines mutually exclusive with clear priority: if `detectDepBump()` returns a result (automated bot PR), use the existing light pipeline. If the PR does not match `detectDepBump()` but contains a `[depends]` marker, use the deep review pipeline. Never run both.
- Unify the detection into a single entry point: extend `DepBumpContext` with a `pipelineType: "automated" | "deep-review"` field. The `detectDepBump()` function becomes the first check; `[depends]` marker detection is the fallback.
- Consider whether `[depends]` is even the right trigger. The existing pipeline already has `fetchChangelog()` and `fetchSecurityAdvisories()` enrichment. The "deep review" might be better modeled as an enrichment level on the existing pipeline rather than a separate pipeline.

**Warning signs:**
- A single PR receives two review comments (one from each pipeline).
- The dep-bump detection logs show the same PR classified by both detectors.
- Test coverage only tests each pipeline in isolation, never the case where both could match.

**Phase to address:**
[depends] PR deep review phase -- detection architecture must be decided before building the deep review logic.

---

### Pitfall 4: CI Failure Attribution Requires Check Runs API, Not Just Workflow Runs API

**What goes wrong:**
The existing `ci-status-server.ts` uses `octokit.rest.actions.listWorkflowRunsForRepo()` (Actions API) filtered by `head_sha`. This only returns GitHub Actions workflow runs. Many repos (including xbmc/xbmc) use external CI systems (Azure Pipelines, Jenkins, CircleCI, Travis) that report status via the **Checks API** (`check_runs` and `check_suites`), not the Actions API. Building CI failure recognition only on top of the existing Actions API means external CI failures are invisible -- the bot would say "all CI passed" when Azure Pipelines is actually failing.

Even for repos using only GitHub Actions, the workflow runs API gives run-level status, not job-level or step-level detail needed for failure attribution ("this failure is in the linting step, which is unrelated to your code changes"). The existing `get_workflow_run_details` tool fetches jobs and steps, but only after the LLM decides to call it -- there is no deterministic pre-fetch.

**Why it happens:**
GitHub has three separate CI status mechanisms:
1. **Commit statuses** (`GET /repos/{owner}/{repo}/commits/{ref}/statuses`) -- legacy, used by Travis/Jenkins.
2. **Check runs** (`GET /repos/{owner}/{repo}/commits/{ref}/check-runs`) -- used by GitHub Actions and modern CI.
3. **Workflow runs** (`GET /repos/{owner}/{repo}/actions/runs`) -- GitHub Actions only, what `ci-status-server.ts` currently uses.

Correctly determining "all CI" requires checking both commit statuses AND check runs. The combined status endpoint (`GET /repos/{owner}/{repo}/commits/{ref}/status`) provides a rolled-up view but loses detail needed for attribution.

**How to avoid:**
- Use the combined status endpoint for pass/fail detection: `octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: headSha })` gives a single `state: "success" | "failure" | "pending"` covering all status reporters.
- Use the check runs endpoint for detailed attribution: `octokit.rest.checks.listForRef({ owner, repo, ref: headSha })` returns all check runs including GitHub Actions, Azure Pipelines, and other apps.
- Do NOT rely on the Actions API (`listWorkflowRunsForRepo`) as the primary source. It misses external CI entirely.
- Pre-fetch deterministically: always fetch CI status before the LLM review, not as an LLM tool call. This ensures CI context is available in the prompt without requiring the LLM to decide to check.

**Warning signs:**
- CI status shows "0 runs" on repos with active CI (because CI uses check runs, not workflow runs).
- The bot says "CI is passing" when the PR has red checks visible in the GitHub UI.
- Failure attribution only works for GitHub Actions but not for external CI systems.

**Phase to address:**
CI failure recognition phase -- must use Checks API as primary data source, not Actions API.

---

### Pitfall 5: CI Failure "Unrelated to PR" Attribution Is Fundamentally Hard

**What goes wrong:**
The core value proposition is "detect and annotate CI failures unrelated to PR scope." Determining whether a failure is "unrelated" requires knowing what the PR changed and what the failing test/check covers. This mapping is generally unavailable. A linting failure in `src/utils.ts` could be unrelated to a PR that only touches `src/auth.ts` -- or it could be caused by it (if `auth.ts` imports from `utils.ts`). Without a full dependency graph of the codebase, attribution is guesswork.

The common heuristics are unreliable:
- "The same check failed on the base branch" -- this is a strong signal but requires an extra API call (`listForRef` on `base_sha`) and does not work for flaky tests.
- "The failure is in a file not touched by the PR" -- fails for transitive dependencies, test infrastructure changes, and environment-specific failures.
- "The failure step name does not match any changed file" -- step names are human-chosen and rarely map cleanly to file paths.

**Why it happens:**
CI systems are black boxes to external observers. A check run reports "failed" with an optional output summary, but the output format is CI-system-specific (GitHub Actions logs, Azure Pipelines JSON, Jenkins HTML). Parsing these outputs to extract "which test failed" is fragile and CI-system-dependent.

**How to avoid:**
- Start with the strongest signal: check if the same check failed on the base branch's HEAD commit. If yes, the failure predates the PR and is definitively unrelated. This requires `octokit.rest.checks.listForRef({ owner, repo, ref: baseSha })` and comparing check names.
- For failures unique to the PR's head commit, do NOT claim they are "unrelated" -- instead, present them as "new failures that may or may not be related to this PR."
- Use the LLM for soft attribution: include the list of failed checks + their names alongside the PR diff in the review prompt, and let the LLM reason about whether the failures are plausibly related. This is less precise but more robust than deterministic heuristics.
- Annotate with confidence: "This failure also occurs on the base branch (HIGH confidence: unrelated)" vs. "This failure is new on this PR (UNKNOWN: may be related)."
- Do NOT block or change merge confidence based on CI failure attribution. Present it as informational context, not a gate.

**Warning signs:**
- The bot declares a CI failure "unrelated" when it was actually caused by the PR (false negative -- could lead to merging broken code).
- API rate limit exhaustion from fetching base-branch CI status on every review.
- The attribution logic silently breaks when a repo switches CI systems.

**Phase to address:**
CI failure recognition phase -- must scope to base-branch comparison as the MVP, not attempt full failure attribution.

---

## Moderate Pitfalls

---

### Pitfall 6: Language-Aware Schema Extension Requires Migration on Production Database

**What goes wrong:**
Adding a `language` column to `learning_memories` and/or `review_comments` tables requires a PostgreSQL migration on the production Azure database. For `learning_memories` with existing rows (potentially 10K+), `ALTER TABLE ADD COLUMN` is fast if the default is NULL, but adding a NOT NULL constraint or backfilling values requires a full table scan. If the backfill includes re-classifying file paths via `classifyFileLanguage()`, this is a code-side operation that must be run as a one-time script, not a SQL migration.

Adding an index on the language column (for filtered retrieval) takes the HNSW index offline during rebuild if combined in the same transaction.

**Why it happens:**
Developers often bundle schema changes with data backfill in the same migration. PostgreSQL DDL + long-running DML in one transaction can hold exclusive locks.

**How to avoid:**
- Migration adds `language TEXT` column with `DEFAULT NULL`. No NOT NULL constraint.
- Backfill runs as a separate script (similar to the existing `review-comment-backfill.ts` pattern) that updates rows in batches of 500 with `classifyFileLanguage(file_path)`.
- New rows populate `language` at write time. Old rows with NULL language get no boost (neutral treatment, consistent with existing "Unknown" handling in `rerankByLanguage`).
- Do NOT add a separate index on `language`. Use it as a filter in the application layer, not a database query predicate. The existing HNSW vector search is the primary access path.

**Warning signs:**
- Migration script runs longer than 10 seconds on production.
- Application starts before backfill completes and encounters NULL language values in hot paths.

**Phase to address:**
Language-aware retrieval boosting phase -- schema migration must be a separate, additive-only step.

---

### Pitfall 7: Hunk-Level Embeddings Create Noise in Cross-Corpus RRF

**What goes wrong:**
The existing RRF pipeline merges code, review comment, and wiki results. Code results currently come from `learning_memories` (one per review finding). If hunk-level embeddings are added to the same `learning_memories` table (or a new table that feeds into the same corpus), the code corpus suddenly has 10-50x more entries per PR. In RRF, more entries in a ranked list means each individual entry gets a lower RRF score (1/(k+rank) decreases as rank increases). But the sheer volume of code entries means more of them appear in the top-K, crowding out review and wiki results.

**Why it happens:**
RRF is rank-based, not score-based. If the code corpus has 500 entries and the review corpus has 50 entries, the code corpus naturally dominates the merged list because it contributes more items to the rank pool.

**How to avoid:**
- Store hunk embeddings in a separate table (e.g., `hunk_embeddings`) with its own retrieval path. Do NOT mix them into `learning_memories`.
- Cap the per-corpus contribution to RRF: limit each source list to `topK` items before feeding into `crossCorpusRRF()`. The current code already does this implicitly (each search returns topK=5 for review/wiki), but learning memories use `variantTopK` which could be larger.
- Consider using hunk embeddings as a re-ranking signal on existing findings rather than as a primary retrieval source. If a finding matches both by learning memory embedding AND by hunk embedding, boost its score.

**Warning signs:**
- After enabling hunk embedding, `unifiedResults` provenance shows code results crowding out review/wiki.
- `SOURCE_WEIGHTS` adjustments have diminishing effect because raw volume overwhelms weights.

**Phase to address:**
Code snippet embedding phase -- must decide on storage architecture before implementation.

---

### Pitfall 8: [depends] Deep Review Changelog Fetching Hits Rate Limits on Batch PRs

**What goes wrong:**
The existing `fetchChangelog()` in `dep-bump-enrichment.ts` resolves the package's GitHub repo via registry APIs (npm, PyPI, RubyGems), then fetches releases and CHANGELOG.md. For a `[depends]` PR that bumps multiple packages (common in manual dependency PRs), this means N registry lookups + N GitHub API calls for releases + N content fetches for changelogs. With 10 packages, that is 30+ API calls. The existing GitHub API rate limit is 5000 req/hr for installation tokens, and each PR review already consumes 50-100 requests for diff/files/comments.

**Why it happens:**
The existing enrichment was designed for single-package Dependabot PRs. Manual `[depends]` PRs often bundle multiple related updates ("upgrade all AWS SDK packages to v3").

**How to avoid:**
- Cap changelog fetching at 5 packages per PR. If more than 5 packages changed, fetch changelogs for only the major-version bumps and skip patch/minor.
- Cache registry lookups. The mapping from "lodash" -> "github.com/lodash/lodash" changes rarely. Store in `dep_bump_merge_history` or a dedicated `package_repo_cache` table.
- Use `Promise.allSettled` with concurrency limiting (existing `p-queue` pattern) for parallel changelog fetching, with a 5-second total timeout for all changelog operations.
- Count remaining API rate budget before starting changelog fetch. The existing telemetry captures rate limit events -- extend this to pre-check budget.

**Warning signs:**
- Rate limit errors (HTTP 403) during review of multi-package `[depends]` PRs.
- Review takes 30+ seconds longer on `[depends]` PRs compared to regular PRs.
- Registry API calls fail silently (fetch returns 429) and changelog shows "unavailable."

**Phase to address:**
[depends] PR deep review phase -- must include rate limit budgeting for multi-package PRs.

---

### Pitfall 9: CI Status Pre-Fetch Adds Latency to Every Review, Not Just Failed CI

**What goes wrong:**
If CI status is pre-fetched deterministically (as recommended in Pitfall 4), every PR review now includes 1-3 API calls to check CI status before the LLM review starts. For PRs where CI is still pending (common on PRs just opened), this adds latency for no value -- CI status changes are not useful until checks complete. For PRs where all CI passes, the CI context bloats the prompt without contributing to the review.

**Why it happens:**
The temptation is to always include CI context "just in case." But CI status is only actionable when there are failures, which is a minority of reviews.

**How to avoid:**
- Make CI pre-fetch conditional: only fetch CI status when the `check_suite` or `check_run` event indicates a failure, or when a review is triggered after CI has had time to complete.
- Alternatively, keep CI status as an MCP tool (the existing pattern) but improve the tool to use Check Runs API instead of Actions API. The LLM can decide to check CI status when it sees test-related changes in the diff.
- For the "annotate CI failures" feature specifically, trigger it from `check_suite.completed` webhooks rather than embedding it in the PR review flow. Post a separate comment about CI failures instead of including it in the review.

**Warning signs:**
- Average review latency increases by 500ms-2s across all PRs, not just those with CI failures.
- Prompt size increases by 1-2KB for CI context that the LLM ignores in 90% of reviews.
- GitHub API usage increases proportionally with review volume.

**Phase to address:**
CI failure recognition phase -- must decide between pre-fetch vs. event-triggered architecture.

---

### Pitfall 10: Language Boosting Without Language Metadata on Review Comments and Wiki

**What goes wrong:**
The existing `rerankByLanguage()` works by calling `classifyFileLanguage(result.record.filePath)` on learning memory results. Review comments have a `file_path` column but wiki pages do not have file paths at all. If language boosting is extended to the unified pipeline, wiki results cannot participate in language matching and will always receive "Unknown" treatment (neutral). This means language boosting only applies to code and review corpora, creating an implicit penalty on wiki results when the PR is in a well-known language.

**Why it happens:**
Wiki pages are about concepts (build systems, architecture, APIs), not about specific files. A wiki page about "CMake build configuration" is relevant to C++ PRs but has no file path to classify.

**How to avoid:**
- For wiki results, use topic-based language affinity instead of file-path classification. Tag wiki pages with relevant languages during ingestion (e.g., "CMake" wiki page -> languages: ["C++", "C"]). Store as a `languages TEXT[]` column on `wiki_pages`.
- For review comments, use the existing `file_path` column for classification (same as learning memories).
- Design the language boosting as a trait/interface: `getLanguages(chunk: UnifiedRetrievalChunk): string[]`. Each source type implements it differently.

**Warning signs:**
- Wiki results about language-specific topics (build systems, tooling) consistently rank below less-relevant code findings.
- Language match ratio in `retrieval_quality_events` shows near-zero for wiki corpus.

**Phase to address:**
Language-aware retrieval boosting phase -- must design per-source language extraction before implementing boosting.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store hunk embeddings in `learning_memories` table | No schema change, reuses existing vector search | Pollutes finding-level data with hunk-level noise, makes cleanup hard, distorts RRF balance | Never -- use a separate table |
| Hard-code language boost factor (0.85/1.15) in unified pipeline | Quick to ship | Cannot tune per-language or per-repo. C++ findings boosted same as TypeScript even though C++ embeddings may be lower quality | MVP only -- make configurable in `.kodiai.yml` within first follow-up |
| Skip base-branch CI check for "unrelated" attribution | Saves 1-2 API calls per review | Cannot distinguish pre-existing failures from PR-introduced ones; all failure attribution is guesswork | Never -- base-branch comparison is the minimum viable signal |
| Inline changelog parsing in review handler | Avoids new module | Changelog parsing logic (markdown heading detection, version range filtering) becomes untestable and unreusable | MVP only -- extract within same phase |
| Use LLM for CI failure attribution without structured input | Leverage LLM reasoning | Non-deterministic results, hard to test, token-expensive | Acceptable as supplement to deterministic base-branch check, never as sole method |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GitHub Checks API | Using `listWorkflowRunsForRepo` (Actions-only) instead of `listForRef` (all checks) | Use `checks.listForRef` for comprehensive CI status; `actions.listWorkflowRuns` as supplementary for step-level detail |
| GitHub Checks API | Fetching check runs for `head_sha` only | Also fetch for `base_sha` to determine pre-existing failures. Cache base-branch status per base SHA to avoid redundant calls |
| Voyage AI (hunk embedding) | Embedding every hunk regardless of PR outcome | Only embed hunks from PRs that produced findings. Skip clean PRs entirely |
| Registry APIs (npm/PyPI) | No timeout on registry fetch | Set 3-second timeout per registry call. `fetch()` with `AbortSignal.timeout(3000)` |
| PostgreSQL HNSW index | Adding large batch of vectors without `REINDEX` | After backfilling hunk embeddings, run `REINDEX INDEX CONCURRENTLY` to maintain HNSW quality. Use `CONCURRENTLY` to avoid locking |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Embedding all hunks in a large PR | Review takes 30s+ before LLM even starts | Cap at 20 hunks per PR; prioritize hunks in high-risk files (use existing `file-risk-scorer.ts`) | PRs with 50+ hunks (refactoring, dependency lockfile changes) |
| Fetching all check runs for a commit | API call returns 100+ checks (monorepo with matrix builds) | Paginate and stop after first page (100 items). Filter by conclusion="failure" to reduce payload | Repos with matrix CI (30+ jobs per commit) |
| Language classification on every retrieval call | `classifyFileLanguage()` is fast but called per result per query | Cache language per file path in the database row at write time, not at read time | Retrieval returning 50+ candidates before topK filtering |
| Full changelog fetch for every dep bump | 3-5 API calls per package for releases + CHANGELOG.md | Cache changelogs by package@version. Changelogs for released versions never change | Repos with frequent Dependabot PRs (20+/week) |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Including CI log output in review comments | CI logs may contain secrets (env vars, tokens leaked in stack traces) | Never include raw CI log content in review output. Only include check name, conclusion, and URL |
| Trusting changelog content from external repos | Changelog/release notes could contain injection payloads (markdown rendering, link hijacking) | Sanitize all changelog text through existing `sanitizeContent()` before including in review. Truncate to 500 chars (already done in `dep-bump-enrichment.ts`) |
| Exposing check run details for private repos | Check run data may reveal internal tooling names and configurations | Ensure CI status data inherits the same repo access permissions as the installation token |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Always annotating CI status even when all checks pass | Review comment noise -- "CI Status: 12/12 passed" adds no value | Only mention CI in review when there are failures or pending checks |
| Showing changelog for every dep bump including patch versions | Patch changelogs are usually "bug fixes" with no actionable detail | Only include changelogs for minor and major version bumps. For patches, mention "patch update" without changelog |
| Using technical language for CI failure attribution | "Check run `build-ubuntu-22.04-gcc-12` failed on base ref" is opaque to most developers | "A CI check (`build-ubuntu-22.04-gcc-12`) is also failing on the base branch, so this failure is likely unrelated to your changes" |
| Language boost silently changing retrieval results | Users notice different retrieval quality without understanding why | Include language match info in retrieval provenance logging. Do NOT surface it in the review comment |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Language-aware boosting:** Often missing language classification for review comments and wiki pages -- verify all three corpora have language metadata, not just learning memories
- [ ] **Hunk embedding:** Often missing staleness management -- verify hunks have TTL expiry and that stale hunks are excluded from retrieval
- [ ] **[depends] deep review:** Often missing mutual exclusivity with existing dep-bump pipeline -- verify a single PR cannot trigger both pipelines
- [ ] **CI failure recognition:** Often missing base-branch comparison -- verify the system checks CI on both head and base commits, not just head
- [ ] **CI failure recognition:** Often missing external CI coverage -- verify the system uses Checks API, not just Actions API
- [ ] **Language boosting schema:** Often missing backfill for existing data -- verify old learning_memories rows get language populated, not just new ones
- [ ] **Hunk embedding:** Often missing cost monitoring -- verify Voyage API usage telemetry tracks hunk embeddings separately from finding embeddings
- [ ] **[depends] deep review:** Often missing rate limit budgeting for multi-package PRs -- verify changelog fetching is capped at 5 packages

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Double language boost (Pitfall 1) | LOW | Remove the duplicate boost path; existing results are rank-order changes only, no data corruption |
| Hunk embedding storage explosion (Pitfall 2) | MEDIUM | Run batch DELETE on stale/old hunk embeddings, REINDEX CONCURRENTLY on HNSW. Add TTL going forward |
| Dual pipeline triggering (Pitfall 3) | LOW | Add mutual exclusivity check in review handler. No data corruption, just duplicate comments to clean up |
| CI status using wrong API (Pitfall 4) | LOW | Replace Actions API calls with Checks API calls in `ci-status-server.ts`. Backward compatible change |
| False CI failure attribution (Pitfall 5) | MEDIUM | Change attribution labels from definitive ("unrelated") to hedged ("likely unrelated based on base branch status"). Review past annotations |
| Language column missing backfill (Pitfall 6) | LOW | Run backfill script. NULL language treated as neutral until backfill completes |
| Hunk noise in RRF (Pitfall 7) | MEDIUM | Migrate hunk embeddings to separate table, adjust RRF pipeline to use separate corpus list |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Double language boost (1) | Language-aware retrieval boosting | Test: same query with language filter produces identical scores in legacy and unified pipeline paths |
| Storage explosion (2) | Code snippet embedding | Test: hunk count per PR is capped at 20; stale hunks excluded from retrieval after TTL |
| Dual pipeline trigger (3) | [depends] PR deep review | Test: PR matching both detectors only runs one pipeline; second detector returns null |
| Wrong CI API (4) | CI failure recognition | Test: external CI (non-Actions) check runs appear in CI status results |
| False attribution (5) | CI failure recognition | Test: failure on both head and base SHA labeled "likely unrelated"; failure only on head labeled "may be related" |
| Migration lock (6) | Language-aware retrieval boosting | Migration runs in under 5 seconds on production; backfill is separate script |
| RRF noise (7) | Code snippet embedding | Test: enabling hunk embedding does not change review/wiki representation in top-5 unified results by more than 1 position |
| Rate limit exhaustion (8) | [depends] PR deep review | Test: PR with 10 packages only fetches changelogs for first 5 major-version bumps |
| CI latency (9) | CI failure recognition | Test: reviews for PRs without CI failures do not add API calls or prompt content for CI |
| Wiki language gap (10) | Language-aware retrieval boosting | Test: wiki pages about C++ topics rank higher when reviewing C++ PRs vs. unrelated PRs |

## Sources

- Existing codebase analysis: `src/knowledge/retrieval.ts`, `src/knowledge/retrieval-rerank.ts`, `src/knowledge/cross-corpus-rrf.ts`, `src/knowledge/hybrid-search.ts`
- Existing dep-bump pipeline: `src/lib/dep-bump-detector.ts`, `src/lib/dep-bump-enrichment.test.ts`
- Existing CI tool: `src/execution/mcp/ci-status-server.ts`
- Database schema: `src/db/migrations/001-initial-schema.sql`, `src/db/migrations/005-review-comments.sql`
- GitHub REST API documentation: Checks API vs Actions API vs Commit Statuses
- Reciprocal Rank Fusion literature: score distribution properties under unbalanced corpus sizes
- Voyage AI pricing model: per-token embedding costs for different model dimensions

---
*Pitfalls research for: Kodiai v0.19 Intelligent Retrieval Enhancements*
*Researched: 2026-02-25*
