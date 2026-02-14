# Feature Landscape

**Domain:** Dependency bump analysis, timeout resilience, and intelligent retrieval for AI code review
**Researched:** 2026-02-14
**Confidence:** MEDIUM-HIGH (GitHub Advisory API verified, retrieval patterns verified in codebase, timeout architecture verified; changelog extraction strategies from training data + competitor analysis)

## Existing Foundation (Already Built)

Before defining v0.9 features, here is what Kodiai already has that these features build on:

| Existing Capability | Module | Relevance to v0.9 |
|---------------------|--------|-------------------|
| PR intent parsing (conventional commits, bracket tags, branch prefixes, labels) | `lib/pr-intent-parser.ts` | Detects `chore(deps):`, `[deps]`, dependency-related labels -- foundation for dep bump detection |
| Auto-profile selection by PR size/intent | `lib/auto-profile.ts` | Can route dep bumps to a specialized profile |
| Risk-weighted file prioritization for large PRs (>50 files) | `lib/file-risk-scorer.ts`, `handlers/review.ts` | Already handles large PRs with tiered review depth |
| Embedding-backed learning memory with sqlite-vec | `learning/memory-store.ts`, `learning/isolation.ts` | Vector retrieval with repo isolation, fixed distance threshold (0.3) |
| Voyage AI embedding provider with fail-open | `learning/embedding-provider.ts` | Single-model embeddings, 1024-dim, 10s timeout |
| Retrieval config (topK, distanceThreshold, maxContextChars) | `execution/config.ts` | Static thresholds, no per-query adaptation |
| Timeout enforcement via AbortController (default 600s) | `execution/executor.ts` | Current approach: binary success/timeout, no partial results |
| Error classification and error comment posting | `lib/errors.ts`, `handlers/review.ts` | Timeout classified as error, generic "timed out" message posted |
| Review Details summary comment (upsert pattern) | `handlers/review.ts` | Can be extended for dep bump metadata and partial result status |
| Diff analysis with language classification (20 languages) | `execution/diff-analysis.ts` | `EXTENSION_LANGUAGE_MAP` provides file-to-language mapping |
| Multi-factor finding prioritization (severity + fileRisk + category + recurrence) | `lib/finding-prioritizer.ts` | Composite scoring already implemented |
| Incremental re-review with finding deduplication | `lib/incremental-diff.ts`, `lib/finding-dedup.ts` | Delta classification (new/resolved/still-open) |
| Knowledge store with review/finding/feedback records | `knowledge/store.ts` | SQLite persistence, can store dep analysis cache |

---

## Table Stakes

Features users expect when a review tool encounters dependency bumps, times out on large PRs, or uses embedding-based retrieval. Missing these makes the product feel half-finished.

### 1. Dependency Bump Detection

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Detect dependency bump PRs from metadata** | Dependabot and Renovate both signal dependency updates via PR title (`chore(deps): bump X from A to B`), labels (`dependencies`, `Type: Depends`), and branch name (`dependabot/npm_and_yarn/...`). The xbmc reference PR #27860 uses title `[depends][target] Bump libcdio to 2.3.0` and label `Component: Depends`. Users expect the review tool to recognize these signals and behave differently from code-change PRs. | LOW | Existing `parsePRIntent()` already extracts conventional commit types. Extend with: (1) title regex for "bump X from A to B" or "update X to Y", (2) label matching for `dependencies`/`depends`/`renovate`/`dependabot`, (3) branch prefix matching for `dependabot/`, `renovate/`. |
| **Extract old and new version numbers from PR title/body** | Every dep bump PR from Dependabot/Renovate includes version info: "Bumps lodash from 4.17.20 to 4.17.21" in the title or body. Without extracting these, the tool cannot look up changelogs or advisories. Regex: `/bump\w*\s+(\S+)\s+from\s+(\S+)\s+to\s+(\S+)/i` covers 90%+ of dep bump titles. | LOW | Pure regex parsing. Fallback: scan changed lockfile/manifest for version diffs. |
| **Extract package name and ecosystem from changed files** | When PR modifies `package.json` / `package-lock.json` (npm), `go.mod` (Go), `Cargo.toml` (Rust), `requirements.txt` (Python), the ecosystem is deterministic. Needed for advisory API queries. | LOW | File path pattern matching. Already have `classifyFileLanguage()` and `filesByCategory` in diff analysis. |

### 2. Changelog and Release Notes Extraction

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Fetch GitHub Releases between old and new version** | Renovate checks for "Releases" metadata and changelog files, then filters to relevant versions. Dependabot includes release notes and changelog entries in PR body. Users expect the review tool to show what changed between versions. GitHub REST API: `GET /repos/{owner}/{repo}/releases` filtered by tag name provides release bodies with breaking change notes. | MEDIUM | Requires: (1) resolving package to source repo (npm registry `repository` field, or GitHub API), (2) listing releases between two version tags, (3) extracting breaking change markers from release body. |
| **Detect breaking changes from version semantics** | Semver major bumps (1.x to 2.x) signal breaking changes. Conventional commit release notes include `BREAKING CHANGE:` markers. Users expect the tool to flag major version bumps prominently. | LOW | Version comparison: `semver.major(newVersion) > semver.major(oldVersion)`. The `semver` npm package or simple regex handles this. |
| **Summarize changelog for review context** | When changelog text is available, inject a concise summary into the review prompt so the LLM can assess whether the PR properly adapts to breaking changes. Renovate embeds changelog in PR body; the review tool should use it as review context, not just repeat it. | LOW | Prompt extension: add changelog summary section to `buildReviewPrompt()`. Truncate to `maxContextChars` to avoid prompt bloat. |

### 3. Security Advisory Lookup

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Query GitHub Advisory Database for known CVEs** | GitHub's Global Advisory API (`GET /advisories?affects=package@version&ecosystem=npm`) returns reviewed security advisories including CVE IDs, severity, and patched versions. CodeRabbit integrates OSV-Scanner for vulnerability detection. Users expect a review tool to flag known vulnerabilities in dependency updates. | MEDIUM | GitHub REST API call with `affects` parameter (supports up to 1000 packages). Requires: package name + ecosystem + version range. Response includes: GHSA ID, CVE ID, severity, vulnerable_version_range, patched_versions. |
| **Report advisory severity and remediation in review** | When advisories exist, embed them in the review summary: "This update resolves CVE-2025-XXXX (HIGH severity) affecting versions <=1.0.2, patched in 1.0.3." | LOW | Format advisory API response into review comment. Already have severity classification infrastructure. |
| **Distinguish security-motivated from maintenance bumps** | When a dep bump resolves a known CVE, the merge urgency is higher. When it is a routine maintenance bump, the review can be more relaxed. Dependabot distinguishes security updates from version updates. | LOW | Check if any advisory matches the OLD version range. If yes: security-motivated. If no: maintenance. |

### 4. Timeout Resilience and Partial Results

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Progressive review with checkpoint publishing** | Current behavior: timeout = error comment, no review output. With a ~10% failure rate on large/complex PRs, users get zero value. Expected: publish whatever findings were generated before timeout. CodeRabbit uses 3600s timeout and buffers output until complete. A better approach: publish partial results at checkpoints. | HIGH | Requires architecture change: (1) intercept MCP tool calls during execution to detect published inline comments, (2) on timeout, post summary of what was reviewed vs. not, (3) mark the review as "partial" in Review Details. This touches executor.ts and review.ts. |
| **Pre-review triage to predict timeout risk** | Before invoking the LLM, estimate whether the PR will likely timeout based on file count, total lines, and language complexity. If high risk, proactively reduce scope. | MEDIUM | Heuristic: if `totalFiles * avgLinesPerFile > threshold`, auto-escalate to minimal profile or reduce `fullReviewCount`. Uses existing diff metrics. |
| **Graceful timeout message with partial context** | Current timeout message: generic "Kodiai timed out." Expected: "Reviewed 45/120 files before timeout. 8 findings published. Re-request review or increase timeoutSeconds." | LOW | Requires tracking published state during execution. The `published` flag already exists in executor.ts but is binary. Extend to track count. |
| **Chunked review for very large PRs (>200 files)** | Current `MAX_ANALYSIS_FILES = 200` truncates analysis. For extremely large PRs, consider splitting into multiple sequential review passes, each covering a file batch. | HIGH | Requires: (1) batch file selection, (2) multiple executor invocations per PR, (3) merging results across batches, (4) combined summary comment. Significant architecture change. |

### 5. Intelligent Retrieval Improvements

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Multi-signal query construction** | Current query: `${pr.title}\n${reviewFiles.slice(0, 20).join("\n")}` (line 1431 of review.ts). This is a naive concatenation. Expected: include PR intent type, severity distribution of prior findings, language distribution, and key diff patterns for richer semantic matching. | MEDIUM | Extend query text construction to include: (1) parsed PR intent type and scope, (2) detected languages from `filesByLanguage`, (3) key diff patterns (e.g., function signatures changed), (4) author experience tier. All signals already available at query construction time. |
| **Adaptive distance threshold** | Current: fixed 0.3 threshold for all queries (config.knowledge.retrieval.distanceThreshold). Research shows higher thresholds yield higher precision but lower recall, and optimal thresholds vary by embedding model, query length, and domain. Expected: adjust threshold based on result distribution. | MEDIUM | Strategy: (1) retrieve with relaxed threshold (e.g., 0.5), (2) examine distance distribution, (3) apply knee-point detection to find natural cluster boundary, (4) filter results above the knee. Alternatively: use percentile-based cutoff (keep results within 1 std-dev of best match). |
| **Language-aware retrieval boosting** | Current vec0 table has `severity` and `category` metadata columns but no `language` column. A Python finding is less relevant to a TypeScript review. Expected: boost results matching the PR's primary language. | MEDIUM | Options: (1) add `language` column to vec0 table (requires migration), (2) post-retrieval re-ranking by language match, (3) include language in query text for semantic matching. Option 2 (post-retrieval re-rank) is simplest and avoids schema migration. |

---

## Differentiators

Features that set Kodiai apart. Not universally expected, but high-value when present.

### Dependency Bump Analysis

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Merge confidence scoring** | Dependabot provides a "compatibility score" based on CI pass rates across GitHub. Kodiai can provide an LLM-assessed confidence score based on: (1) semver analysis (patch vs minor vs major), (2) changelog breaking change markers, (3) CVE resolution status, (4) usage analysis (does the codebase use affected APIs?). No competitor provides LLM-analyzed merge confidence for dependency bumps. | MEDIUM | Requires all table-stakes dep analysis features. Score is a composite of: semver safety (patch=high, major=low), advisory resolution (resolves CVE=boost), breaking changes detected (lower confidence), usage analysis (uses changed APIs=lower). |
| **Usage analysis: does the codebase use affected APIs?** | When a dependency introduces breaking changes, the key question is "does our code use the changed APIs?" Kodiai can grep the workspace for import statements and function calls matching the dependency's changed exports. No competitor does this analysis. | HIGH | Requires: (1) extracting changed exports/APIs from changelog/release notes (LLM-assisted), (2) searching the workspace for usage patterns (existing Grep/Glob tools), (3) reporting which specific usages are at risk. Complex but extremely valuable. |
| **Dependency update history tracking** | Track which packages have been updated, how often, and whether past updates caused issues (via feedback). "This package was last updated 3 months ago; the previous bump from 2.0 to 2.1 was merged without issues." | LOW | Knowledge store extension: store dep bump records (package, from_version, to_version, outcome). Query on future bumps. |
| **Multi-package update correlation** | When a PR updates multiple related packages (e.g., `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`), note the coordination and check for version compatibility requirements. | LOW | Parse multiple version changes from lockfile/manifest diffs. Check if packages share a scope prefix (`@scope/`). |

### Timeout Resilience

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Adaptive timeout based on PR complexity** | Instead of a fixed `timeoutSeconds`, compute timeout dynamically: `baseTimeout + (fileCount * perFileTimeout) + (avgLines * lineTimeout)`. Large PRs get longer timeouts automatically. | LOW | Pure math based on diff metrics. Extend executor config with dynamic timeout computation. |
| **Review progress streaming** | Post a "reviewing..." comment with live progress updates (e.g., "Analyzing file 23/45..."). Delete or update on completion. Provides visibility during long reviews. | MEDIUM | Requires: periodic progress callback from executor, comment creation/update during execution. Risk: notification noise if not done carefully (use a single comment, update in place). |
| **Retry with reduced scope on timeout** | When a review times out, automatically retry with a reduced file set (top 50% by risk score). Publish the reduced review rather than nothing. | HIGH | Requires: (1) detecting timeout before cleanup, (2) re-invoking executor with reduced scope, (3) coordinating with job queue for retry, (4) marking result as "reduced scope." |

### Intelligent Retrieval

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Query-time severity/category filtering** | Current vec0 table has `severity` and `category` columns. Use them for filtered retrieval: when reviewing a security-focused PR, boost security-category memories. When profile is `minimal`, only retrieve `critical`/`major` severity memories. | LOW | The vec0 virtual table already supports WHERE clauses on metadata columns. Extend retrieval query with optional severity/category filters based on resolved review profile. |
| **Recency-weighted retrieval** | Older memories may reflect outdated patterns. Boost recent memories: apply a time-decay multiplier to distance scores. Memories from the last 30 days get 0.9x distance (closer), 90+ days get 1.1x (farther). | LOW | Post-retrieval score adjustment using `createdAt` field from memory records. Pure math, no schema changes. |
| **Cross-language concept mapping** | A "null safety" finding in Java is semantically similar to "optional chaining" in TypeScript. Language-aware retrieval should recognize cross-language concept equivalence. | HIGH | Requires either: (1) embedding model that naturally handles multi-language code concepts (Voyage Code 3 may already do this), (2) explicit concept mapping layer. Test with current embeddings first before adding complexity. |
| **Retrieval quality metrics** | Track retrieval hit rates: how often retrieved memories influence the review output. If distance thresholds are too tight (few results) or too loose (noisy results), flag for tuning. | LOW | Log retrieval result counts, distances, and whether the finding outcome was used. Aggregate in telemetry. |

---

## Anti-Features

Features to explicitly NOT build. These are commonly requested but harmful or premature.

| Anti-Feature | Why Tempting | Why Avoid | What to Do Instead |
|--------------|-------------|-----------|-------------------|
| **Full dependency tree analysis** | "Analyze all transitive dependencies for vulnerabilities." | Scope explosion. A single npm project can have 500+ transitive deps. Advisory lookup for each would hit rate limits (GitHub Advisory API is rate-limited) and slow down reviews dramatically. | Analyze only the packages directly changed in the PR diff. Transitive deps are the domain of `npm audit` / Dependabot alerts, not a code review tool. |
| **Automatic lockfile regeneration** | "If a dep bump has issues, auto-fix the lockfile." | Write operations on lockfiles are dangerous and ecosystem-specific. npm, yarn, pnpm, bun all have different lockfile formats. Getting it wrong breaks installs. | Report the issue; let the developer fix it. Kodiai's review role is advisory, not remedial. |
| **Real-time CVE monitoring (webhook)** | "Monitor for new CVEs and auto-create PRs." | This is Dependabot's core product. Reimplementing it poorly adds liability. GitHub already provides security alerts, Dependabot security updates, and code scanning. | Look up advisories at review time for the specific versions being bumped. Point-in-time analysis, not continuous monitoring. |
| **Streaming partial review via SSE/WebSocket** | "Stream review findings to the PR in real-time as they're generated." | GitHub's API is REST-based. Streaming to a PR comment requires repeated API calls (one per finding), generating excessive notification noise and hitting rate limits. CodeRabbit explicitly moved AWAY from streaming to buffered output. | Buffer findings, publish as a batch. For timeout resilience, publish at checkpoints (every N files or at timeout), not per-finding. |
| **Multi-pass review (review-then-review-the-review)** | "Run a second LLM pass to validate findings from the first." | Doubles cost and latency with diminishing returns. The existing enforcement pipeline (severity floors, tooling detection, confidence scoring, feedback suppression) already filters low-quality findings. | Improve the single-pass prompt quality. Use retrieval context to reduce false positives. The enforcement pipeline IS the validation layer. |
| **Custom embedding model training** | "Fine-tune embeddings on this repo's code for better retrieval." | Requires substantial training data, GPU infrastructure, and ongoing model management. Voyage Code 3 is already trained on code. The marginal improvement from fine-tuning on a single repo's findings is unlikely to justify the complexity. | Use multi-signal query construction and post-retrieval re-ranking. These are simpler and more maintainable than model fine-tuning. |
| **Semantic diff for dependency changes** | "Parse the AST of old and new dependency versions to find API changes." | Requires downloading and parsing source code of npm packages, which is infeasible at review time (packages can be megabytes, multi-language, etc.). | Use changelog/release notes as a proxy for API changes. If changelog mentions "removed function X," search the codebase for usage of function X. |
| **Predictive timeout estimation with ML** | "Train a model to predict review duration and set timeouts dynamically." | No training data, massive overengineering. Heuristics (file count x complexity) are sufficient and debuggable. | Use simple heuristic: `baseTimeout + (fileCount * perFileSeconds)`. Tune the constants empirically from telemetry data. |

---

## Feature Dependencies

```text
DEPENDENCY BUMP ANALYSIS
=========================
[Existing: PR intent parsing, diff analysis, review prompt]
    |
    +-- extends --> [Dep bump detection from title/labels/branch/files]
    |                   |
    |                   +-- produces --> [Package name + old version + new version + ecosystem]
    |                   |
    |                   +-- feeds --> [GitHub Advisory API lookup]
    |                   |                   |
    |                   |                   +-- produces --> [CVE list, severity, patched versions]
    |                   |                   |
    |                   |                   +-- feeds --> [Security vs maintenance classification]
    |                   |
    |                   +-- feeds --> [GitHub Releases API changelog fetch]
    |                   |                   |
    |                   |                   +-- produces --> [Changelog text between versions]
    |                   |                   |
    |                   |                   +-- feeds --> [Breaking change detection from changelog]
    |                   |
    |                   +-- feeds --> [Merge confidence scoring]
    |                                     |
    |                                     +-- integrates --> semver analysis
    |                                     +-- integrates --> advisory resolution status
    |                                     +-- integrates --> breaking change count
    |                                     +-- optional --> usage analysis (grep for affected APIs)

TIMEOUT RESILIENCE
===================
[Existing: AbortController timeout, error classification, error comment]
    |
    +-- extends --> [Pre-review timeout risk estimation]
    |                   |
    |                   +-- feeds --> [Adaptive scope reduction (auto-escalate to minimal)]
    |                   |
    |                   +-- feeds --> [Dynamic timeout computation]
    |
    +-- extends --> [Partial result tracking during execution]
    |                   |
    |                   +-- requires --> [Track published inline comments count]
    |                   |
    |                   +-- feeds --> [Graceful timeout message with partial context]
    |
    +-- deferred --> [Checkpoint-based partial publishing]
    |
    +-- deferred --> [Retry with reduced scope]

INTELLIGENT RETRIEVAL
======================
[Existing: isolation layer, memory store, embedding provider, retrieval config]
    |
    +-- extends --> [Multi-signal query construction]
    |                   |
    |                   +-- integrates --> PR intent type/scope
    |                   +-- integrates --> detected languages
    |                   +-- integrates --> diff pattern signatures
    |                   +-- integrates --> author experience tier
    |
    +-- extends --> [Adaptive distance threshold]
    |                   |
    |                   +-- requires --> [Retrieve with relaxed threshold]
    |                   +-- requires --> [Knee-point or percentile-based cutoff]
    |
    +-- extends --> [Language-aware retrieval boosting]
    |                   |
    |                   +-- option A --> [Post-retrieval re-ranking by language]
    |                   +-- option B --> [Add language to query text]
    |
    +-- optional --> [Severity/category filtered retrieval]
    +-- optional --> [Recency-weighted scoring]
    +-- optional --> [Retrieval quality metrics in telemetry]
```

### Critical Path

1. **Dep bump detection** is prerequisite for all other dep analysis features. Must extract package name, versions, and ecosystem before anything else can work.
2. **Advisory lookup** and **changelog fetch** are independent of each other but both depend on dep bump detection.
3. **Merge confidence scoring** integrates signals from advisory lookup, changelog analysis, and semver analysis -- build last.
4. **Timeout risk estimation** is independent and can ship first as a pure heuristic.
5. **Multi-signal query construction** is independent of adaptive thresholds; both improve retrieval but can ship separately.

### Independence Points

- All three feature areas (dep bumps, timeout, retrieval) are **fully independent** of each other
- Within dep bumps: advisory lookup and changelog fetch are **fully independent**
- Within retrieval: multi-signal query and adaptive threshold are **fully independent**
- Timeout resilience features are mostly independent of each other (risk estimation, graceful messages, partial publishing)

### Integration Points

- Dep bump detection feeds into review prompt (new section) and Review Details (new metadata)
- Timeout risk estimation feeds into auto-profile selection (reduce scope for risky PRs)
- Multi-signal query uses signals from dep bump detection (if available) and auto-profile resolution
- All three areas share the review handler entry point in `review.ts`

---

## MVP Recommendation

### Build First (P1) -- Core value, low risk

1. **Dep bump detection from PR metadata** -- Regex parsing of title/body for version bumps, label matching, branch prefix matching. Extend existing `parsePRIntent()`. Pure logic, zero API calls.

2. **Version extraction (package name, old/new version, ecosystem)** -- Parse "bump X from A to B" pattern and detect ecosystem from changed manifest files. Foundation for all dep analysis.

3. **GitHub Advisory API lookup** -- Single REST call with `affects=package@version&ecosystem=npm`. Fail-open if API errors. High value: surfaces known CVEs in review.

4. **Breaking change detection from semver** -- `major(new) > major(old)` flags as breaking. Zero API calls, zero dependencies beyond simple version comparison.

5. **Graceful timeout message with context** -- Replace generic "timed out" with "Reviewed X/Y files, N findings published before timeout." Low effort, high UX value.

6. **Pre-review timeout risk estimation** -- Heuristic from file count and line count. Auto-reduce scope for high-risk PRs. Addresses 10% failure rate.

7. **Multi-signal query construction** -- Enrich the retrieval query text with PR intent, languages, and diff patterns. Improves retrieval relevance with no infrastructure changes.

### Build Second (P2) -- Depth and integration

8. **Changelog/release notes fetch from GitHub Releases** -- Resolve package to source repo, list releases between versions, extract breaking change markers. Requires npm registry lookup for source URL.

9. **Dep bump review prompt section** -- Inject advisory results, changelog summary, and breaking change flags into review prompt. Enables LLM-aware dependency analysis.

10. **Merge confidence scoring** -- Composite score from semver, advisories, changelog breaking changes. Reported in Review Details summary.

11. **Adaptive distance threshold** -- Retrieve with relaxed threshold, apply statistical cutoff. Improves retrieval precision without manual tuning.

12. **Language-aware retrieval boosting** -- Post-retrieval re-rank by language match. Boost same-language memories, demote cross-language.

13. **Dynamic timeout computation** -- `baseTimeout + (fileCount * perFileSeconds)`. Replaces fixed 600s default.

### Defer (P3) -- Future value, high complexity

14. **Usage analysis (grep for affected APIs)** -- Search codebase for imports/usage of APIs mentioned in breaking changes. Very high value but complex: requires parsing changelog for API names, then workspace search.

15. **Checkpoint-based partial publishing** -- Detect published inline comments during execution, on timeout publish summary of partial results. Requires executor architecture changes.

16. **Retry with reduced scope on timeout** -- Auto-retry with top 50% files by risk. Requires job queue coordination.

17. **Dependency update history tracking** -- Knowledge store extension for dep bump records. Low effort but depends on dep bump detection being stable.

18. **Retrieval quality metrics** -- Telemetry for retrieval hit rates, distance distributions, outcome correlation. Important for tuning but not user-facing.

19. **Cross-language concept mapping** -- Test if Voyage Code 3 already handles this; only build if it does not.

20. **Review progress streaming** -- Live "reviewing..." comment with progress. Risk of notification noise.

---

## Feature Prioritization Matrix

| Feature | User Value | Impl. Cost | Risk | Priority |
|---------|------------|------------|------|----------|
| Dep bump detection from PR metadata | **HIGH** | LOW | LOW | **P1** |
| Version extraction (package, old, new, ecosystem) | **HIGH** | LOW | LOW | **P1** |
| GitHub Advisory API lookup (CVE check) | **HIGH** | MEDIUM | LOW | **P1** |
| Breaking change detection from semver | **HIGH** | LOW | LOW | **P1** |
| Graceful timeout message with context | **HIGH** | LOW | LOW | **P1** |
| Pre-review timeout risk estimation | **HIGH** | MEDIUM | LOW | **P1** |
| Multi-signal query construction | MEDIUM | MEDIUM | LOW | **P1** |
| Changelog/release notes fetch | HIGH | MEDIUM | MEDIUM | **P2** |
| Dep bump review prompt section | HIGH | LOW | LOW | **P2** |
| Merge confidence scoring | MEDIUM | MEDIUM | LOW | **P2** |
| Adaptive distance threshold | MEDIUM | MEDIUM | MEDIUM | **P2** |
| Language-aware retrieval boosting | MEDIUM | LOW | LOW | **P2** |
| Dynamic timeout computation | MEDIUM | LOW | LOW | **P2** |
| Usage analysis (affected APIs) | HIGH | HIGH | MEDIUM | **P3** |
| Checkpoint-based partial publishing | MEDIUM | HIGH | HIGH | **P3** |
| Retry with reduced scope | MEDIUM | HIGH | MEDIUM | **P3** |
| Dep update history tracking | LOW | LOW | LOW | **P3** |
| Retrieval quality metrics | LOW | LOW | LOW | **P3** |
| Cross-language concept mapping | LOW | HIGH | MEDIUM | **P3** |
| Review progress streaming | LOW | MEDIUM | MEDIUM | **P3** |

---

## Competitor Feature Analysis

### Dependency Bump Analysis

| Tool | Approach | Strength | Weakness |
|------|----------|----------|----------|
| **Dependabot** | Creates PRs for bumps with release notes, changelog, and compatibility score (CI pass rate across GitHub). Distinguishes security updates from version updates. | Ecosystem-wide compatibility scoring from real CI data. Automatic PR creation. | Does not analyze whether the codebase uses affected APIs. Compatibility score often "unknown" for less popular packages. |
| **Renovate** | Four-stage pipeline (init, extract, lookup, update). Checks GitHub Releases and changelog files, filters to relevant versions, embeds in PR body. `postUpgradeTasks` for custom automation. | Richest changelog extraction. Multi-platform support (GitHub, GitLab, Bitbucket). Groups related updates. | Cannot analyze breaking change impact on the codebase. No LLM-powered analysis. |
| **CodeRabbit** | Integrates OSV-Scanner for vulnerability detection. Reviews dependency changes alongside code changes. Uses 40+ linters including TruffleHog for secrets. | Combined code + dependency review in one tool. Security scanner integration. | Does not extract changelogs or provide merge confidence scoring. Treats dep bumps like regular code changes. |
| **Kodiai (proposed)** | Detect dep bump from PR metadata. Extract versions. Query GitHub Advisory API. Fetch changelog from GitHub Releases. Assess semver breaking changes. LLM-analyzed merge confidence with optional usage analysis. | LLM-powered contextual analysis: "does this breaking change affect YOUR code?" Usage analysis is unique. Merge confidence combines multiple signals. | New capability, needs validation. Changelog extraction limited to GitHub Releases (not arbitrary changelog files). |

### Timeout Resilience

| Tool | Approach | Strength | Weakness |
|------|----------|----------|----------|
| **CodeRabbit** | 3600s timeout, concurrency of 8. Buffers full output, delivers as batch. Moved away from streaming to buffered. Sends "most relevant callers" to LLM when context window overflows. | Long timeout accommodates most PRs. Smart context selection. | No partial results on timeout. All-or-nothing. |
| **Qodo Merge** | Independent per-run execution. No persistent state between runs. | Clean, no drift risk. | No progressive review. No partial results. |
| **GitHub Copilot Code Review** | Static review comments only. Limited to context window. | Fast, single-pass. | Cannot handle very large PRs. No fallback strategy. |
| **Kodiai (proposed)** | Pre-review risk estimation with auto-scope reduction. Graceful timeout messages with partial context. Dynamic timeout based on PR complexity. Deferred: checkpoint publishing and retry with reduced scope. | Proactive: prevents timeouts rather than just handling them. Informative: tells users what was and was not reviewed. | Checkpoint publishing is architecturally complex. |

### Intelligent Retrieval

| Tool | Approach | Strength | Weakness |
|------|----------|----------|----------|
| **CodeRabbit** | Automated web queries for recent public information. Project knowledge for coding plans. | Always-current information from web. | Not embedding-based. Not learning from past reviews. |
| **Research (RAG literature)** | Hybrid retrieval (sparse + dense), query decomposition, re-ranking, multi-stage pipelines. | Proven patterns at scale. | General-purpose, not code-review-specific. |
| **Kodiai (current)** | Repo-scoped vector retrieval with sqlite-vec. Fixed distance threshold (0.3). Query = title + first 20 file names. Owner-level sharing optional. | Repo isolation by design. Provenance tracking. | Naive query construction. Fixed threshold misses variable quality. No language awareness. |
| **Kodiai (proposed)** | Multi-signal query (intent + languages + diff patterns). Adaptive threshold (knee-point detection). Language-aware post-retrieval re-ranking. Optional severity/category filtering. | Contextually rich queries. Self-tuning thresholds. Language relevance. | Adaptive threshold adds complexity. Language re-ranking is heuristic-based. |

---

## User Experience Implications

### Dependency Bump Analysis

- **Information density**: Dep bump reviews should be concise. A 100-line changelog dump in the review comment is noise. Summarize to 3-5 key points: semver type, breaking changes, CVEs resolved, confidence score.
- **Merge signal**: The merge confidence score should be prominent and unambiguous. "Merge confidence: HIGH (patch update, no breaking changes, resolves CVE-2025-1234)" gives the reviewer immediate signal.
- **False positive risk**: Not all files named `package.json` are npm manifests (could be test fixtures). Use heuristic: must be at root or in a recognized subdirectory pattern.
- **Ecosystem coverage**: Start with npm/Node.js (most common for GitHub Apps), then Go, Python, Rust. Don't try to support all ecosystems at once.

### Timeout Resilience

- **User trust**: Timeouts erode trust. "Your review tool timed out and produced nothing" is worse than "Your review tool completed a partial review." Even a partial result with 3 findings is better than nothing.
- **Notification noise**: Timeout messages and partial result updates should not generate excessive notifications. Use the existing upsert pattern for the Review Details comment (single comment, update in place).
- **Scope transparency**: When auto-reducing scope, disclose it: "PR scope reduced due to complexity: reviewing top 30 files by risk (of 120 total). Full review available with `@kodiai full-review`."

### Intelligent Retrieval

- **Invisible improvement**: Better retrieval manifests as better review quality, not as a visible feature. Users will not see "multi-signal query" but will notice more relevant findings.
- **Threshold sensitivity**: Adaptive thresholds must have safety bounds. Never return zero results (floor: top 1 result regardless of distance). Never return noise (ceiling: distance > 0.8 regardless of distribution).
- **Provenance continues**: The existing delta reporting with learning provenance already shows retrieval sources. Improved retrieval feeds directly into this existing UX.

---

## Sources

### Direct Evidence (HIGH confidence -- verified in codebase)
- `src/handlers/review.ts` lines 1427-1460 -- current retrieval query construction: `${pr.title}\n${reviewFiles.slice(0, 20).join("\n")}`
- `src/learning/isolation.ts` -- retrieval with fixed `distanceThreshold`, repo isolation, owner-level sharing
- `src/learning/memory-store.ts` -- vec0 virtual table with `severity`, `category` metadata columns, no `language` column
- `src/execution/executor.ts` -- AbortController timeout (default 600s), binary success/timeout result
- `src/lib/errors.ts` -- timeout classified as "timeout" error category, generic error message
- `src/execution/config.ts` lines 255-267 -- retrieval config: `topK: 5`, `distanceThreshold: 0.3`, `maxContextChars: 2000`
- `src/execution/diff-analysis.ts` -- `EXTENSION_LANGUAGE_MAP` for 20 languages, `classifyFileLanguage()`
- `src/lib/pr-intent-parser.ts` -- existing PR intent parsing (conventional commits, bracket tags)

### GitHub API (HIGH confidence -- verified via official docs)
- [GitHub Global Advisory API](https://docs.github.com/en/rest/security-advisories/global-advisories) -- `GET /advisories?affects=package@version&ecosystem=npm`, returns CVE ID, severity, patched versions. Up to 1000 packages per query.
- [GitHub Advisory Database](https://github.com/github/advisory-database) -- Open Source Vulnerability (OSV) format, npm ecosystem advisories including malware

### Competitive Intelligence (MEDIUM confidence)
- [Renovate changelog extraction](https://docs.renovatebot.com/key-concepts/changelogs/) -- checks GitHub Releases and changelog files, filters to relevant versions
- [Dependabot compatibility score](https://github.com/dependabot/dependabot-core/issues/4001) -- CI pass rate from public repos; minimum threshold for score display
- [CodeRabbit OSV-Scanner integration](https://docs.coderabbit.ai/changelog) -- vulnerability scanning via OSV.dev
- [CodeRabbit architecture (Google Cloud)](https://cloud.google.com/blog/products/ai-machine-learning/how-coderabbit-built-its-ai-code-review-agent-with-google-cloud-run) -- 3600s timeout, concurrency 8, buffered output over streaming

### Research (MEDIUM confidence)
- [VectorSearch: Enhancing Document Retrieval](https://arxiv.org/html/2409.17383v1) -- similarity threshold tuning, higher thresholds yield higher precision but lower recall
- [RAG Techniques Repository](https://github.com/NirDiamant/RAG_Techniques) -- multi-signal query construction, hybrid retrieval, re-ranking patterns
- [BUMP: Breaking Dependency Updates Dataset](https://github.com/chains-project/bump) -- SANER 2024 research on breaking dependency updates

### Reference PR (HIGH confidence)
- [xbmc/xbmc#27860](https://github.com/xbmc/xbmc/pull/27860) -- `[depends][target] Bump libcdio to 2.3.0`, labels: `Type: Improvement`, `Component: Depends`, 4 files changed including VERSION file and patches

---
*Feature research for: Kodiai v0.9 -- Dependency Bump Analysis, Timeout Resilience, Intelligent Retrieval*
*Researched: 2026-02-14*
