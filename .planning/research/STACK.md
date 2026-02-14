# Technology Stack

**Project:** Kodiai v0.9 -- Dependency Bump Analysis, Timeout Resilience, Intelligent Retrieval
**Researched:** 2026-02-14
**Overall Confidence:** HIGH

## Executive Summary

This milestone adds three capability areas to the existing Kodiai codebase. The critical finding is that **zero new npm dependencies are needed** for any of the three features. Every capability leverages existing infrastructure: Bun's native `Bun.semver` for version comparison, the already-installed `@octokit/rest` for GitHub Advisory API and GitHub Releases API access, the existing Voyage AI embedding provider for multi-signal queries, and the existing SQLite + sqlite-vec stack for adaptive threshold storage.

For dependency bump analysis: `Bun.semver` provides `order()` and `satisfies()` natively (20x faster than node-semver). The missing `diff()` function (major/minor/patch classification) is a 10-line pure function on parsed version strings. CVE lookup uses the GitHub Advisory Database API via `octokit.rest.securityAdvisories.listGlobalAdvisories()` already typed in the installed `@octokit/rest@22.0.1`. Changelog fetching uses `octokit.rest.repos.getReleaseByTag()` for GitHub-hosted projects, with a plain `fetch()` fallback for CHANGELOG.md files on GitHub/npm.

For timeout resilience: the executor already has `AbortController`-based timeout enforcement. Progressive review requires publishing partial results before timeout via the existing MCP comment server. No new timeout or chunking library is needed -- the pattern is "check elapsed time between review phases, publish what you have if running low."

For intelligent retrieval: the existing `isolationLayer.retrieveWithIsolation()` already accepts `queryEmbedding`, `topK`, and `distanceThreshold`. Multi-signal queries are a prompt construction change (build better query text from PR title + file paths + diff hunks + language). Adaptive thresholds are a SQLite table tracking retrieval quality over time and adjusting the `distanceThreshold` config value per-repo.

## Recommended Stack

### No New Dependencies Required

| What's Needed | Already Available | Where |
|---------------|-------------------|-------|
| Semver comparison | `Bun.semver.order()`, `Bun.semver.satisfies()` | Bun runtime built-in |
| Semver diff (major/minor/patch) | 10-line pure function parsing `X.Y.Z` | New utility (zero deps) |
| CVE/advisory lookup | `octokit.rest.securityAdvisories.listGlobalAdvisories()` | `@octokit/rest@22.0.1` (already installed) |
| Changelog from GitHub Releases | `octokit.rest.repos.getReleaseByTag()` | `@octokit/rest@22.0.1` (already installed) |
| Changelog from raw files | `fetch()` to GitHub raw content URLs | Bun built-in `fetch` |
| Dependency manifest detection | `diffAnalysis.riskSignals` includes "Modifies dependency manifest" | `src/execution/diff-analysis.ts` |
| Timeout enforcement | `AbortController` with `setTimeout` | `src/execution/executor.ts` (line 43-47) |
| Partial result publishing | MCP comment server `publishReviewComment` tool | `src/execution/mcp/comment-server.ts` |
| Vector similarity search | `sqlite-vec` with `learning_memory_vec` table | `src/learning/memory-store.ts` |
| Embedding generation | Voyage AI `embed()` with `inputType: "query"` | `src/learning/embedding-provider.ts` |
| Distance threshold filtering | `isolationLayer.retrieveWithIsolation()` | `src/learning/isolation.ts` |
| Configuration schemas | Zod schemas with section fallback | `src/execution/config.ts` |

### Existing Dependencies (No Version Changes)

| Technology | Version | Purpose | Used For New Features |
|------------|---------|---------|----------------------|
| `@octokit/rest` | ^22.0.1 | GitHub API | Advisory Database API, Releases API for changelog, repo content fetch |
| `@octokit/webhooks-types` | ^7.6.1 | Type definitions | No new types needed |
| `zod` | ^4.3.6 | Schema validation | Config extensions for dep analysis, timeout, retrieval |
| `bun:sqlite` | builtin | Persistent storage | Adaptive threshold tracking, dep analysis cache |
| `sqlite-vec` | ^0.1.7-alpha.2 | Vector search | Multi-signal query retrieval (same infrastructure) |
| `voyageai` | ^0.1.0 | Embeddings | Multi-signal query embedding generation |
| `pino` | ^10.3.0 | Structured logging | Telemetry for all three feature areas |
| `p-queue` | ^9.1.0 | Concurrency control | No changes needed |
| `hono` | ^4.11.8 | HTTP framework | No changes needed |
| `picomatch` | ^4.0.2 | Glob matching | No changes needed |

## Feature-Specific Stack Details

### Feature 1: Dependency Bump Analysis

**Detection: Which files signal a dependency bump?**

The diff analysis already detects dependency manifest changes (package.json, go.mod, Cargo.toml, requirements.txt, etc.) via path-based risk signals in `src/execution/diff-analysis.ts` (line 145-157). The new feature extends this detection to parse the actual diff content of these files to extract version changes.

**Semver comparison: Use Bun.semver (no library needed)**

Bun provides native semver with `Bun.semver.order()` and `Bun.semver.satisfies()`, which are 20x faster than the `semver` npm package. The one missing function is `diff()` to classify a version change as major/minor/patch/prerelease. This is a trivial pure function:

```typescript
type SemverDiffType = "major" | "minor" | "patch" | "prerelease" | null;

function semverDiff(from: string, to: string): SemverDiffType {
  const parse = (v: string) => {
    const clean = v.replace(/^v/, "");
    const [core, pre] = clean.split("-", 2);
    const parts = core.split(".").map(Number);
    return { major: parts[0], minor: parts[1], patch: parts[2], pre };
  };
  const a = parse(from);
  const b = parse(to);
  if (a.major !== b.major) return "major";
  if (a.minor !== b.minor) return "minor";
  if (a.patch !== b.patch) return "patch";
  if (a.pre !== b.pre) return "prerelease";
  return null;
}
```

Why NOT use the `semver` npm package (7.7.x, 50KB): We need exactly one function (`diff`) that is a 10-line string split. Adding a 50KB dependency with 30+ functions for a single trivial operation is unjustified. `Bun.semver.order()` handles all comparison needs natively.

**CVE lookup: Use GitHub Advisory Database API (already in Octokit)**

The `@octokit/rest@22.0.1` already includes typed endpoints for the GitHub Advisory Database:

```typescript
// List advisories for a specific npm package
const { data: advisories } = await octokit.rest.securityAdvisories.listGlobalAdvisories({
  ecosystem: "npm",          // npm, pip, go, rubygems, maven, nuget, rust, etc.
  affects: "lodash@4.17.20", // package@version format
  severity: "medium,high,critical",
  type: "reviewed",          // Only reviewed (not unreviewed/malware)
  per_page: 10,
});

// Each advisory contains: ghsa_id, cve_id, summary, description,
// severity, vulnerabilities[].package, vulnerabilities[].vulnerable_version_range,
// vulnerabilities[].patched_versions
```

Rate limit: Uses the standard REST rate limit (5000/hour), NOT the search rate limit. The advisory endpoint supports filtering by ecosystem and package, so a single call per dependency bump is sufficient.

Why NOT use the OSV.dev API: GitHub Advisory Database is the upstream source for npm advisories. Using it directly via the already-installed Octokit avoids adding a new HTTP client, new types, and another API to monitor. OSV.dev aggregates FROM GitHub Advisory Database for npm.

Why NOT use `npm audit` / `bun audit`: These require a full lockfile and operate on the entire dependency tree. We need per-package version-specific advisory lookup, not a full audit.

**Changelog fetching: Use GitHub Releases API + raw content fetch (already in Octokit)**

Strategy with prioritized fallback:

```typescript
// Priority 1: GitHub Releases (most packages publish release notes)
const { data: release } = await octokit.rest.repos.getReleaseByTag({
  owner: "lodash",
  repo: "lodash",
  tag: `v${version}`, // or just version
});
// release.body contains markdown changelog

// Priority 2: Fetch CHANGELOG.md from repo
const response = await fetch(
  `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/CHANGELOG.md`
);
// Parse to extract section for target version

// Priority 3: npm registry metadata (has repository URL, homepage)
const npmMeta = await fetch(`https://registry.npmjs.org/${packageName}`);
// Extract repository.url to find the GitHub repo
```

The repo owner/name for npm packages comes from the npm registry metadata (`repository.url` field), which is a single unauthenticated `fetch()` call per package. No new dependency needed.

**Package manifest diff parsing: Pure functions, no library**

Parsing `package.json` diffs to extract dependency version changes is JSON diffing:

```typescript
// For package.json: parse old and new versions from git diff
// The diff is already available in the PR files -- just need to parse
// the +/- lines in the dependency sections
type DependencyChange = {
  name: string;
  from: string;
  to: string;
  diffType: SemverDiffType;
  section: "dependencies" | "devDependencies" | "peerDependencies";
};
```

For non-JSON manifests (go.mod, Cargo.toml, requirements.txt), regex-based parsers handle the well-defined formats. These are formal grammars, not natural language.

**What NOT to add for dependency bump analysis:**

| Do NOT Add | Rationale |
|------------|-----------|
| `semver` npm package | `Bun.semver` handles comparison; `diff()` is a 10-line function |
| `npm-fetch-changelog` | Does too much (full version range iteration); we need a single version lookup |
| `osv-scanner` or OSV client | GitHub Advisory Database is the primary source for npm; already in Octokit |
| `lockfile-diff` | We parse specific manifest files from the PR diff, not lockfiles |
| `snyk` or `sonatype` APIs | Vendor-locked, requires API keys, GitHub Advisory Database is free and sufficient |
| Dependabot integration | Dependabot creates PRs; we analyze existing PRs -- different concern |

**Confidence: HIGH** -- Bun.semver verified running in current runtime. Octokit advisory types verified in node_modules. GitHub Releases API verified in Octokit types.

---

### Feature 2: Timeout/Chunked Review Resilience

**Current state of timeout handling:**

The executor (`src/execution/executor.ts`, line 39-47) already implements `AbortController`-based timeout with configurable `timeoutSeconds` (default 600s = 10 minutes). When timeout fires, the abort signal kills the Agent SDK query and the handler posts an error comment (line 2279-2293 of `review.ts`).

The problem: on timeout, ALL review work is lost. Zero output is published.

**Solution: Progressive review with checkpoint publishing**

The approach is NOT chunking the review into separate Agent SDK calls (which would lose context). Instead:

1. **Time budget awareness**: Pass remaining time budget to the review prompt so the LLM can prioritize.
2. **Checkpoint publishing**: Before the Agent SDK call, set up a "safety net" timer that fires at ~80% of timeout. If the review hasn't completed by then, the handler checks if any partial output was published via MCP tools and, if not, publishes a summary comment noting the review was truncated.
3. **File prioritization**: The existing large PR file triage (`triageFilesByRisk()` in `src/lib/file-risk-scorer.ts`) already prioritizes high-risk files. For timeout resilience, ensure the prompt instructs the LLM to review high-risk files first and publish findings incrementally.

```typescript
// Existing infrastructure -- no new deps:
// 1. AbortController timeout (executor.ts)
// 2. MCP comment server can publish at any time during execution
// 3. File risk scoring already prioritizes files
// 4. Large PR triage already limits review scope

// NEW: Safety net timer at 80% of timeout
const safetyNetMs = timeoutMs * 0.8;
const safetyNetTimer = setTimeout(async () => {
  if (!published) {
    // Post partial results or "review truncated" comment
    await postTruncatedReviewComment(octokit, { owner, repo, prNumber });
  }
}, safetyNetMs);
```

**What about chunked/progressive review across multiple Agent SDK calls?**

Evaluated and rejected for v0.9. Running multiple sequential Agent SDK calls would:
1. Lose cross-file context that makes reviews valuable
2. Multiply cost (each call has system prompt overhead)
3. Add significant complexity for incremental context passing
4. Create race conditions with the existing idempotency system

The simpler approach for v0.9: make the single review call more resilient by (a) being time-aware in the prompt, (b) publishing incrementally via MCP tools, and (c) having a safety net for truncated reviews.

**What NOT to add for timeout resilience:**

| Do NOT Add | Rationale |
|------------|-----------|
| Message queue (BullMQ, etc.) | Overkill; a setTimeout callback is sufficient for safety net |
| Streaming response parser | Agent SDK handles streaming; we need checkpoint publishing, not stream parsing |
| Worker threads | Review execution is already async; parallelism doesn't help single-PR review |
| External scheduler (cron) | Timeout is per-request, not scheduled |
| Circuit breaker library (opossum, etc.) | The fail-open pattern with error comments is already the circuit breaker |

**Confidence: HIGH** -- All building blocks exist. This is an orchestration change using existing infrastructure.

---

### Feature 3: Intelligent Retrieval Improvements

**Current retrieval pipeline (verified in codebase):**

1. Query text construction: `${pr.title}\n${reviewFiles.slice(0, 20).join("\n")}` (review.ts line 1431)
2. Embedding generation: `embeddingProvider.generate(queryText, "query")` via Voyage AI (embedding-provider.ts)
3. Vector search: `isolationLayer.retrieveWithIsolation()` with `distanceThreshold: 0.3` (default)
4. Result filtering: by distance threshold, repo isolation, deduplication
5. Context injection: matched findings injected into review prompt

**Improvement 1: Multi-signal query construction**

Currently the query text is just PR title + file paths. This misses important signals:

```typescript
// CURRENT (review.ts:1431)
const queryText = `${pr.title}\n${reviewFiles.slice(0, 20).join("\n")}`;

// IMPROVED: Multi-signal query
function buildRetrievalQuery(params: {
  prTitle: string;
  reviewFiles: string[];
  diffAnalysis: DiffAnalysis;
  prLabels: string[];
  languages: string[]; // from file extensions
}): string {
  const signals: string[] = [];

  // Signal 1: PR title (semantic intent)
  signals.push(params.prTitle);

  // Signal 2: Top risk files (most relevant paths)
  const topFiles = params.reviewFiles.slice(0, 10);
  signals.push(topFiles.join("\n"));

  // Signal 3: Risk signals (detected patterns)
  if (params.diffAnalysis.riskSignals.length > 0) {
    signals.push(params.diffAnalysis.riskSignals.join(", "));
  }

  // Signal 4: Languages (for language-specific patterns)
  if (params.languages.length > 0) {
    signals.push(`Languages: ${params.languages.join(", ")}`);
  }

  // Signal 5: Categories from labels
  if (params.prLabels.length > 0) {
    signals.push(`Labels: ${params.prLabels.join(", ")}`);
  }

  return signals.join("\n");
}
```

This is a pure function change with zero new dependencies. The embedding provider already handles arbitrary text input.

**Improvement 2: Adaptive distance thresholds**

Currently `distanceThreshold` is a static config value (default 0.3). Adaptive thresholds track retrieval quality per-repo and adjust:

```sql
-- Track retrieval outcome quality
CREATE TABLE IF NOT EXISTS retrieval_quality_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  distance_threshold REAL NOT NULL,
  results_returned INTEGER NOT NULL,
  results_useful INTEGER DEFAULT 0,  -- updated by feedback
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Computed adaptive threshold per repo
-- Simple approach: if retrievals at 0.3 consistently return 0 useful results,
-- tighten to 0.25. If they consistently return useful results, loosen to 0.35.
```

The adaptive logic is a simple moving average over the last N retrievals per repo, stored in the existing SQLite database. No ML, no optimization library -- just `AVG(results_useful)` over a sliding window.

**Improvement 3: Language-aware boosting**

When retrieving prior findings, boost results that match the current PR's primary language(s). This is a post-retrieval re-ranking step:

```typescript
function rerankByLanguageAffinity(
  results: RetrievalResult[],
  prLanguages: Set<string>,
): RetrievalResult[] {
  return results.sort((a, b) => {
    const aLangMatch = prLanguages.has(extractLanguage(a.record.filePath)) ? 0 : 0.05;
    const bLangMatch = prLanguages.has(extractLanguage(b.record.filePath)) ? 0 : 0.05;
    return (a.distance + aLangMatch) - (b.distance + bLangMatch);
  });
}
```

This is a pure function -- no new dependencies. Language detection from file extensions is trivial and already implicit in the codebase via picomatch patterns.

**What NOT to add for intelligent retrieval:**

| Do NOT Add | Rationale |
|------------|-----------|
| Second embedding model | One Voyage AI model is sufficient; multi-model adds complexity and cost |
| Re-ranking model (Cohere, etc.) | Simple heuristic re-ranking (language affinity) is sufficient for v0.9 |
| Full-text search engine (MeiliSearch, Typesense) | sqlite-vec handles the vector search; adding FTS is premature |
| Graph database for relationships | SQLite relational queries handle the simple relationships needed |
| Feature store (Feast, etc.) | Overkill; a SQLite table for threshold tracking is sufficient |
| Learning-to-rank library | The retrieval set is small (topK=5); sophisticated ranking is unnecessary |

**Confidence: HIGH** -- All improvements operate on existing infrastructure. Multi-signal query is a string construction change. Adaptive thresholds are a SQLite table + simple math. Language boosting is a sort function.

---

## Database Schema Additions

### New Tables

```sql
-- Dependency advisory cache (Feature 1)
-- Caches GitHub Advisory Database lookups per package@version
CREATE TABLE IF NOT EXISTS dep_advisory_cache (
  ecosystem TEXT NOT NULL,           -- npm, pip, go, etc.
  package_name TEXT NOT NULL,
  package_version TEXT NOT NULL,
  advisories_json TEXT NOT NULL,     -- JSON array of advisory summaries
  has_advisories INTEGER NOT NULL DEFAULT 0,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ecosystem, package_name, package_version)
);

-- Retrieval quality tracking (Feature 3)
-- Tracks whether retrieved memories were useful for adaptive thresholds
CREATE TABLE IF NOT EXISTS retrieval_quality_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  distance_threshold REAL NOT NULL,
  results_returned INTEGER NOT NULL,
  results_cited INTEGER DEFAULT 0,   -- how many retrieved findings appeared in final review
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rql_repo ON retrieval_quality_log(repo);
```

### Schema Changes to Existing Tables

**NONE.** All three features work with existing table structures plus the two new tables above.

## Configuration Schema Extensions

```yaml
# New config sections for v0.9
review:
  # Dependency bump analysis (Feature 1)
  dependencyAnalysis:
    enabled: true                # Default: true
    ecosystems:                  # Which ecosystems to analyze
      - npm
      - pip
      - go
      - rust
    advisoryLookup: true         # Look up CVEs for bumped packages
    changelogFetch: true         # Fetch changelog/release notes
    maxDepsToAnalyze: 10         # Skip analysis if >10 deps changed (likely lockfile churn)

  # Timeout resilience (Feature 2)
  timeout:
    safetyNetPercent: 80         # Publish partial results at this % of timeout
    truncatedReviewEnabled: true # Post "review truncated" comment on timeout

# Knowledge section extensions (Feature 3)
knowledge:
  retrieval:
    # Existing fields (unchanged)
    enabled: true
    topK: 5
    distanceThreshold: 0.3
    maxContextChars: 2000
    # New fields
    adaptiveThreshold: true      # Adjust distanceThreshold per-repo based on quality
    multiSignalQuery: true       # Use enhanced query construction
    languageBoost: 0.05          # Distance penalty for language mismatch
```

## API Rate Limit Impact

| Feature | API Calls | Rate Limit | Mitigation |
|---------|-----------|------------|------------|
| Advisory lookup | 1 per changed dependency (max 10) | 5000/hour (REST) | Cache 24h per package@version; cap at maxDepsToAnalyze |
| Changelog fetch (GitHub Releases) | 1 per changed dependency | 5000/hour (REST) | Cache; only for major/minor bumps |
| Changelog fetch (npm registry) | 1 per package needing repo URL | No auth needed | Cache repo URL indefinitely |
| Changelog fetch (raw CHANGELOG.md) | 1 per package (fallback) | Unauthenticated or REST | Only when GitHub Release not found |
| Timeout safety net | 0 additional calls | N/A | Uses existing MCP publish path |
| Multi-signal query | 1 Voyage AI call (same as today) | Voyage AI rate limit | Same call, different input text |
| Adaptive threshold | 0 additional calls | N/A | Local SQLite reads/writes only |

**Worst case per review with dep bumps:** ~20 additional REST API calls (10 advisory + 10 changelog). With caching, subsequent reviews of the same dependencies cost 0 calls. All calls are fail-open.

## Integration Points with Existing Stack

### Where Each Feature Connects

```
Feature 1: Dependency Bump Analysis
  Detection:   src/execution/diff-analysis.ts     -- detect dep manifest changes (EXISTING signal)
  Parser:      src/lib/dep-bump-parser.ts (new)    -- parse version changes from diff hunks
  Advisory:    src/lib/advisory-lookup.ts (new)    -- GitHub Advisory Database queries
  Changelog:   src/lib/changelog-fetch.ts (new)    -- GitHub Releases + raw file fetch
  Prompt:      src/execution/review-prompt.ts      -- inject dep analysis context section
  Cache:       src/knowledge/store.ts              -- dep_advisory_cache table
  Config:      src/execution/config.ts             -- dependencyAnalysis schema

Feature 2: Timeout Resilience
  Executor:    src/execution/executor.ts           -- safety net timer at 80% timeout
  Handler:     src/handlers/review.ts              -- truncated review comment posting
  Prompt:      src/execution/review-prompt.ts      -- time budget awareness section
  MCP:         src/execution/mcp/comment-server.ts -- incremental publishing (EXISTING)
  Config:      src/execution/config.ts             -- timeout.safetyNetPercent schema

Feature 3: Intelligent Retrieval
  Query:       src/handlers/review.ts (line 1431)  -- replace simple query with multi-signal
  Isolation:   src/learning/isolation.ts           -- no changes needed (accepts any embedding)
  Reranker:    src/learning/reranker.ts (new)      -- language-aware post-retrieval boosting
  Threshold:   src/learning/adaptive-threshold.ts (new) -- per-repo threshold tracking
  Store:       src/knowledge/store.ts              -- retrieval_quality_log table
  Config:      src/execution/config.ts             -- retrieval schema extensions
```

### Data Flow

```
PR webhook arrives
  |
  +-- Diff analysis detects "Modifies dependency manifest" risk signal (EXISTING)
  |
  +-- IF dependency manifest changed:
  |     +-- Parse diff hunks for package.json/go.mod/etc. to extract version changes
  |     +-- For each changed dep (up to maxDepsToAnalyze):
  |     |     +-- Classify bump type via semverDiff() (major/minor/patch)
  |     |     +-- Lookup CVEs via GitHub Advisory API (cached)
  |     |     +-- Fetch changelog via GitHub Releases API (cached, major/minor only)
  |     +-- Build dependency analysis context section for prompt
  |
  +-- Build multi-signal retrieval query (Feature 3)
  |     +-- Embed with Voyage AI (same call, richer text)
  |     +-- Retrieve via isolation layer with adaptive threshold
  |     +-- Rerank by language affinity
  |
  +-- Set up safety net timer at 80% of timeout (Feature 2)
  |
  +-- Execute review via Agent SDK (EXISTING pipeline)
  |     +-- Prompt includes dep analysis context + retrieval context
  |     +-- LLM reviews files in risk-priority order (EXISTING)
  |     +-- LLM publishes findings via MCP tools (EXISTING)
  |
  +-- IF safety net fires before completion:
  |     +-- Post truncated review comment with partial findings
  |
  +-- After completion: log retrieval quality for adaptive threshold (Feature 3)
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Semver comparison | `Bun.semver` (native) | `semver` npm package (7.7.x) | 50KB for functions Bun provides natively; only need trivial `diff()` |
| CVE lookup | GitHub Advisory Database API | OSV.dev API | GitHub Advisory DB is upstream source for npm; already in Octokit |
| CVE lookup | GitHub Advisory Database API | Snyk API | Vendor-locked, requires separate API key, rate-limited |
| Changelog fetch | GitHub Releases API + raw fetch | `npm-fetch-changelog` library | Library iterates all versions; we need single-version lookup |
| Changelog fetch | GitHub Releases API | npm registry changelog field | npm registry doesn't have changelog; only has repository URL |
| Timeout handling | Safety net timer + truncated comment | Chunked multi-call review | Multi-call loses cross-file context, multiplies cost |
| Timeout handling | Safety net timer | External job queue (BullMQ) | Massive complexity for a setTimeout callback |
| Retrieval improvement | Multi-signal query text | Multiple embedding queries merged | Single query is cheaper; Voyage AI handles multi-signal text well |
| Adaptive threshold | SQLite moving average | ML-based threshold optimization | Sliding window average is debuggable; ML is opaque for 5 data points |
| Language boosting | Post-retrieval distance penalty | Pre-retrieval language filter | Pre-filtering eliminates potentially relevant cross-language findings |

## What NOT to Add (Avoiding Bloat)

| Do NOT Add | Rationale |
|------------|-----------|
| `semver` npm package | Bun.semver handles comparison; diff() is 10 lines |
| `npm-fetch-changelog` | Over-fetches; we need single version lookup |
| `osv-scanner` / OSV client | GitHub Advisory DB is the primary source, already in Octokit |
| `lockfile-diff` | We parse manifest diffs, not lockfile diffs |
| Snyk/Sonatype SDKs | Vendor-locked, separate API keys |
| BullMQ / job queue | setTimeout is sufficient for safety net |
| Redis | SQLite handles the caching and threshold tracking |
| Cohere / re-ranking model | Heuristic re-ranking is sufficient for small result sets |
| MeiliSearch / Typesense | sqlite-vec already handles vector search |
| Second embedding model | One Voyage AI model is sufficient |
| Worker threads | Review execution is async; parallelism doesn't help |

## Version Compatibility

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| `Bun.semver` | Bun 1.1+ | Available since Bun 1.0.11; tested in current runtime |
| Advisory API | `@octokit/rest@22.0.1` | `securityAdvisories.listGlobalAdvisories()` typed |
| Releases API | `@octokit/rest@22.0.1` | `repos.getReleaseByTag()`, `repos.listReleases()` typed |
| New SQLite tables | `bun:sqlite` WAL mode | Additive tables only; no schema changes to existing |
| Config extensions | `zod@4.3.6` | Same schema patterns as existing config |
| Embedding generation | `voyageai@0.1.0` | Same `embed()` call, different input text |

## Sources

### Primary (HIGH confidence -- verified in codebase and runtime)
- `src/execution/diff-analysis.ts` (line 145-157) -- dependency manifest risk signal detection patterns
- `src/execution/executor.ts` (line 39-47) -- AbortController timeout enforcement
- `src/handlers/review.ts` (line 1427-1460) -- retrieval query construction and isolation layer usage
- `src/learning/isolation.ts` -- `retrieveWithIsolation()` with distance threshold filtering
- `src/learning/embedding-provider.ts` -- Voyage AI embedding generation with fail-open
- `src/learning/memory-store.ts` (line 165-174) -- sqlite-vec vector search query
- `src/execution/config.ts` (line 255-267) -- retrieval config schema with distanceThreshold
- `node_modules/@octokit/plugin-rest-endpoint-methods` -- verified `securityAdvisories` and `repos.releases` endpoints
- Bun runtime -- verified `Bun.semver.order()` and `Bun.semver.satisfies()` working

### Secondary (MEDIUM confidence -- verified via official docs)
- [Bun Semver API Reference](https://bun.com/reference/bun/semver) -- `order()` and `satisfies()` only; NO `diff()` method
- [GitHub REST API: Global Security Advisories](https://docs.github.com/en/rest/security-advisories/global-advisories) -- `GET /advisories` with ecosystem/affects/severity filters
- [GitHub REST API: Releases](https://docs.github.com/en/rest/releases) -- `GET /repos/{owner}/{repo}/releases/tags/{tag}`
- [OSV.dev API](https://google.github.io/osv.dev/post-v1-querybatch/) -- Evaluated as alternative; not recommended (GitHub Advisory DB is upstream for npm)

### Tertiary (LOW confidence -- general ecosystem knowledge)
- [npm-fetch-changelog](https://www.npmjs.com/package/npm-fetch-changelog) -- Evaluated and rejected; iterates all versions
- [lockfile-diff](https://www.npmjs.com/package/lockfile-diff) -- Evaluated and rejected; parses lockfiles not manifest diffs
- [semver npm package](https://www.npmjs.com/package/semver) -- v7.7.4; evaluated and rejected in favor of Bun.semver

---
*Stack research for: Kodiai v0.9 -- Dependency Bump Analysis, Timeout Resilience, Intelligent Retrieval*
*Researched: 2026-02-14*
