# Domain Pitfalls

**Domain:** Adding dependency bump analysis, timeout/chunked review resilience, and intelligent retrieval improvements to an existing AI code review system
**Researched:** 2026-02-14
**Confidence:** HIGH (integration pitfalls verified against codebase; dependency analysis pitfalls from Renovate/Dependabot ecosystem research + NVD/OSV data quality studies; retrieval pitfalls from Voyage AI docs + sqlite-vec codebase analysis)

---

## Critical Pitfalls

Mistakes that cause incorrect security advisories, lost review output, data corruption, or require architectural rework.

---

### Pitfall 1: Changelog Fetching Returns Stale, Wrong, or No Data for Most Packages

**What goes wrong:**
Dependency bump analysis needs to show "what changed" between version A and B. The naive approach: fetch the GitHub release notes or CHANGELOG.md for the new version. In practice, changelog data is unreliable across the ecosystem. npm packages frequently lack a `repository` field, or the field points to a monorepo root rather than the specific package directory. GitHub Releases exist for some versions but not others (maintainers forget, or use a different tagging convention like `v1.0.0` vs `1.0.0` vs `package-name@1.0.0`). CHANGELOG.md files exist in varying formats -- Keep a Changelog, unstructured prose, auto-generated commit logs -- and version headers use inconsistent formats (`## 1.2.0`, `### [1.2.0]`, `# v1.2.0 (2025-01-15)`).

Renovate's own changelog fetching system, one of the most mature in the ecosystem, still fails to find changelog entries for a significant percentage of packages. Their system uses GitHub GraphQL API to fetch releases (requires authentication), falls back to parsing CHANGELOG.md, and still produces empty results frequently. The problem is fundamental: there is no standard for changelog availability or format.

**Why it happens:**
The npm registry `repository` field is optional and often incorrect (points to a monorepo, uses `git+ssh://` URLs that need transformation, or is simply missing). GitHub release tags follow no standard naming convention. CHANGELOG.md parsing requires heuristic version-header detection that fails on non-standard formats. Private registries may strip metadata compared to public registries.

**Consequences:**
- Dependency analysis shows "No changelog available" for 30-50% of bumps, making the feature feel broken.
- Wrong changelog shown when tag resolution heuristic picks the wrong tag (e.g., `v2.0.0` matched when the package uses `@scope/package@2.0.0`).
- Monorepo packages show the entire repo's changelog, not the specific package's changes (e.g., showing all Babel package changes when only `@babel/core` was bumped).
- Users lose trust in the dependency analysis feature and ignore it, including the cases where it correctly identifies breaking changes.

**Prevention:**
- Accept imperfection upfront. Design the UI/output to gracefully degrade: "Changelog: [link to releases page]" when specific version changelog is unavailable, rather than "No changelog found."
- Use a multi-source cascade with short-circuit: (1) GitHub Releases API for exact tag match, (2) CHANGELOG.md in repo root, (3) package `changelog` field from registry metadata, (4) fallback to a link to the compare URL (`github.com/owner/repo/compare/v1.0.0...v2.0.0`). The compare URL is always constructable if the repo URL and tag convention are known.
- For monorepo detection: check if the `repository.directory` field exists in package.json metadata. If it does, scope changelog search to that directory. If not, check for Lerna/Nx/Turborepo workspace configuration to identify monorepo structure.
- Cache changelog results per package+version pair in the knowledge store. Changelogs are immutable once published -- they never change for a given version.
- Rate limit GitHub API calls for changelog fetching. A PR bumping 20 dependencies means 20+ API calls. Use conditional requests (If-None-Match) and batch where possible.
- Set a hard time budget for changelog fetching (e.g., 5 seconds total for all dependencies in a PR). Individual fetches that exceed 2 seconds get the fallback compare URL.

**Detection:**
- Changelog hit rate below 50% across all dependency bumps (track as telemetry metric).
- Users report "wrong changelog shown" for monorepo packages.
- GitHub API rate limit warnings during dependency analysis.

**Phase to address:**
Dependency bump analysis phase -- changelog fetching strategy must be designed before implementation. The fallback cascade and time budget are architectural decisions, not implementation details.

---

### Pitfall 2: CVE Data Has Massive False Positive and False Negative Rates

**What goes wrong:**
Dependency bump analysis flags a package version as "has known vulnerabilities" based on CVE/NVD data. But the data is fundamentally unreliable: Sonatype's 2025 analysis found nearly 20,000 false positives and over 150,000 false negatives in NVD data. 64% of open source CVEs in 2025 had no CVSS score in the NVD. Of those that were scored after the fact, almost half turned out to be High or Critical. Severity alignment across sources is weak: only 19% of CVE severity categories matched across analysis sources, and 62% overstated severity.

The average delay between public disclosure and NVD scoring in 2025 was 6 weeks, with some CVEs waiting over 50 weeks. This means a "clean" scan today may miss actively exploited vulnerabilities.

If Kodiai reports CVE data, it inherits these accuracy problems. False positives erode trust ("the bot keeps flagging safe packages"). False negatives create a dangerous illusion of safety ("the bot said no vulnerabilities").

**Why it happens:**
NVD's processing capacity has not kept pace with the 32% increase in CVE submissions in 2024. CPE (Common Platform Enumeration) naming has 50% inconsistency in vendor names. The NVD backlog continues to grow despite processing improvements. OSV.dev, which aggregates from NVD and other sources, can only convert slightly over 50% of in-scope CVEs to OSV records with the current implementation.

**Consequences:**
- False positive: Bot flags a dependency bump as "vulnerable" when the CVE applies to a different version range, different platform, or has been disputed. Developer wastes time investigating a non-issue. Repeated false positives train developers to ignore all vulnerability warnings.
- False negative: Bot shows "no known vulnerabilities" for a package that has unscored or unconverted CVEs. Developer merges with false confidence.
- Stale data: Bot reports a vulnerability that was patched in the exact version being bumped TO, because the fix was released before the NVD entry was updated.
- The fail-open design philosophy means vulnerability data errors should not block reviews, but presenting inaccurate vulnerability data is arguably worse than presenting none.

**Prevention:**
- Use OSV.dev API over raw NVD. OSV uses package-ecosystem-native identifiers (npm package names, not CPEs), reducing false matches. OSV also has ecosystem-specific advisories from GitHub Security Advisories (GHSA), which are generally higher quality than NVD-only data.
- Always show vulnerability data as informational, never blocking. Frame as: "Advisory: GHSA-xxxx-xxxx (moderate) may affect versions < 2.1.0" not "VULNERABILITY DETECTED."
- Include a confidence signal: "Source: GitHub Security Advisory (high confidence)" vs "Source: NVD (moderate confidence, unverified version range)."
- Cross-reference the bump direction: if bumping FROM a vulnerable version TO a fixed version, frame positively: "This bump resolves GHSA-xxxx-xxxx." If bumping TO a version with known advisories, frame as a warning.
- Cache advisory lookups per package+version with a 24-hour TTL. Vulnerability databases change, but not minute-to-minute.
- Never claim "no vulnerabilities" -- say "no known advisories" to accurately reflect the limitations of the data sources.

**Detection:**
- Users report "the bot flagged X but it's not actually vulnerable" (false positive tracking).
- Users discover a post-merge vulnerability that the bot should have caught (false negative -- harder to detect).
- Advisory data shows a CVE with no CVSS score (indicates NVD backlog -- log as low-confidence).

**Phase to address:**
Dependency bump analysis phase -- data source selection (OSV vs NVD) and confidence framing must be decided before implementation. This is a trust design problem.

---

### Pitfall 3: Chunked Review Publishes Partial Results Then Full Results, Creating Duplicate Comments

**What goes wrong:**
The 10% timeout failure rate on large repos (observed on xbmc) motivates chunked review: split the review into chunks, publish partial results as they complete, so even if the overall review times out, the user gets something. The critical failure mode: chunk 1 (files A-J) completes and publishes 4 inline comments. Chunk 2 (files K-Z) completes and publishes 3 more. The system then attempts to publish the summary comment, which references all 7 findings. But what if chunk 1 times out? The system retries with a recovery strategy. The retry succeeds and publishes findings for files A-J -- but 2 of the 4 findings from the first attempt already exist as inline comments. Now the PR has duplicate inline comments.

The existing idempotency system (`ensureReviewOutputNotPublished` at line 1168 of review.ts) uses a `reviewOutputKey` based on head SHA and event action. But chunked reviews would need per-chunk idempotency keys, and the system was not designed for partial success states.

**Why it happens:**
The executor (executor.ts) is an all-or-nothing pipeline: it either succeeds and returns a result, or fails with an error. There is no concept of "partial success" -- the `published` boolean is set by the `onPublish` callback when the MCP tool posts a comment, but there is no tracking of WHICH comments were published. The review handler checks for review output existence via the `reviewOutputKey` marker in comment HTML, but inline review comments use a different marker pattern than the summary comment. Chunked review introduces a new state: "some chunks succeeded, some failed" -- which the existing architecture does not model.

**Consequences:**
- Duplicate inline comments on the same code lines (user sees the same finding twice).
- Summary comment references findings that were not published (chunk timed out, summary counted it).
- Summary comment missing findings that WERE published by earlier chunks.
- If retry logic re-executes a successful chunk, the LLM may produce slightly different findings (non-deterministic), leading to conflicting comments on the same lines.
- The `extractFindingsFromReviewComments` function (line 1645) extracts findings from ALL review comments with the review output key -- if duplicates exist, finding extraction double-counts.

**Prevention:**
- Do NOT publish inline comments from individual chunks. Instead, accumulate findings from all chunks in memory, then publish once all chunks complete (or after timeout). This preserves the existing all-or-nothing publish model.
- If progressive publishing is required (publish as you go), implement per-chunk idempotency: each chunk gets a unique key (`reviewOutputKey + "-chunk-1"`). Before publishing chunk results, check if that chunk's marker already exists. Use the same `ensureReviewOutputNotPublished` pattern but scoped to the chunk key.
- Track published comment IDs in the review handler's state. On retry or timeout recovery, clean up (delete) partial comments from failed chunks before re-publishing. The `onPublish` callback in executor.ts already fires on publish -- extend it to capture the comment ID.
- Consider a simpler architecture: instead of chunking the LLM execution, chunk the prompt. Send a single LLM call with a subset of files (prioritized by risk score from the existing `computeFileRiskScores`). If it succeeds, publish. If it times out, reduce the file set and retry with a smaller prompt. This is a "progressive reduction" strategy rather than "parallel chunks."
- The progressive reduction approach integrates cleanly with the existing `tieredFiles` system: first attempt reviews `full + abbreviated` tiers. On timeout, retry with only `full` tier. On second timeout, retry with top-10 highest-risk files only. Each attempt is a complete review with a single publish point.

**Detection:**
- Duplicate inline comments on the same PR (same file + same line range + similar finding text).
- Summary comment count mismatches total inline comment count.
- Review telemetry shows multiple `published: true` results for the same reviewOutputKey.

**Phase to address:**
Timeout resilience phase -- the chunking/progressive strategy must be decided before implementation. Progressive reduction is strongly recommended over parallel chunks because it preserves the existing single-publish architecture.

---

### Pitfall 4: Timeout Recovery Creates Race Condition with In-Flight Job Queue

**What goes wrong:**
The existing job queue uses `PQueue({ concurrency: 1 })` per installation. When a review times out (AbortController fires at line 45 of executor.ts), the executor's catch block returns an `isTimeout: true` result. The review handler receives this and wants to retry with a reduced scope. But the retry is a new job that must go through the queue. If the original timed-out job's cleanup (workspace deletion, telemetry recording) has not completed, the retry job may start before cleanup finishes.

Worse: the AbortController aborts the Claude Agent SDK query, but the SDK may have already issued MCP tool calls that are in-flight. The MCP tool call to `publishReviewComment` might succeed AFTER the abort signal fires but BEFORE the timeout error is returned to the review handler. The review handler sees `isTimeout: true, published: false` and decides to retry -- but a partial review was already published by the in-flight MCP tool call.

**Why it happens:**
The current executor.ts streams messages from the SDK query (lines 131-144). When the AbortController fires, the `for await` loop terminates with an error. But MCP tool calls are issued by the SDK to external MCP servers (which are in-process but async). The abort signal cancels the SDK's next LLM call, but MCP tool calls already dispatched may complete independently. The `published` flag is set by `onPublish` callback, but this callback fires when the MCP server processes the tool call -- which is asynchronous and may race with the abort.

**Consequences:**
- Retry publishes a second review on top of a partial review from the timed-out attempt.
- `published` flag is false in the timeout result, but a comment was actually published (callback race).
- Workspace is cleaned up while the timed-out MCP tool call is still accessing it.
- Knowledge store records a timeout for a review that actually published results.

**Prevention:**
- Before retrying after timeout, ALWAYS check for existing review output using the idempotency check (`ensureReviewOutputNotPublished`). If any output exists for this reviewOutputKey, skip retry or clean it up first.
- Add a "cooldown" between timeout and retry: wait 5 seconds after timeout to allow in-flight MCP tool calls to settle. Then check idempotency.
- Track published comment IDs in the `onPublish` callback. On timeout, if any comments were published, either (a) accept the partial review and enhance it, or (b) delete the partial comments before retrying.
- Do not retry in the same queue execution. Instead, post a "Review timed out, retrying with reduced scope" message and enqueue a new event. This ensures the original job's cleanup completes fully before the retry starts.
- The error comment system (`postOrUpdateErrorComment` in errors.ts) already posts timeout messages. Extend it to include: "Retrying with reduced scope..." rather than the current generic "Try breaking the task into smaller pieces" suggestion.

**Detection:**
- Two review summaries on the same PR for the same head SHA.
- Timeout telemetry followed by a successful review with the same reviewOutputKey.
- `published: false` in timeout result but review comments exist on the PR.

**Phase to address:**
Timeout resilience phase -- race condition handling must be designed before retry logic is implemented. The cooldown + idempotency check pattern is non-negotiable.

---

### Pitfall 5: Retrieval Query Construction Is Too Naive for Meaningful Results

**What goes wrong:**
The current retrieval query (line 1431 of review.ts) concatenates the PR title with the first 20 file paths: `const queryText = `${pr.title}\n${reviewFiles.slice(0, 20).join("\n")}`;`. This produces embedding queries like:

```
fix: update user authentication middleware
src/auth/middleware.ts
src/auth/types.ts
src/routes/login.ts
...
```

This text is embedded and compared against stored finding embeddings (which contain finding text like "Missing null check on user.session before accessing session.token"). The semantic overlap between file paths and finding descriptions is weak. The query is optimized for "what files are being changed" not "what kinds of issues were found before" -- these are fundamentally different semantic spaces.

The current `distanceThreshold` (configurable, default likely in the 0.4-0.6 range for cosine distance) either returns too many low-relevance results (threshold too high) or misses relevant findings (threshold too low), because the query is in a different semantic neighborhood than the stored findings.

**Why it happens:**
The retrieval system was built as a v0.7/v0.8 feature with a simple query construction as a starting point. The embedding model (Voyage AI) produces 1024-dimensional vectors, and similarity search works well when query and document are in the same semantic space. But PR titles and file paths are metadata, not finding descriptions. Searching for "auth middleware files" does not reliably find "null check on session" findings, even though they are topically related.

**Consequences:**
- Retrieval returns irrelevant findings (different code area, different issue type) that confuse the LLM's review.
- Retrieval returns no results even when relevant historical findings exist, because the query is semantically distant.
- The LLM receives "previous findings" context that is not actually relevant, potentially biasing it to look for similar issues in unrelated code.
- Users see "Based on prior reviews..." context that references unrelated findings, damaging trust.
- Wasted Voyage AI API calls (embedding generation) for queries that produce no useful retrieval.

**Prevention:**
- Build multi-signal queries. Instead of title + file paths, construct queries that represent the review's semantic intent:
  - Signal 1: PR title + conventional type (e.g., "fix: authentication" -> "authentication bug fix")
  - Signal 2: Language + file categories (e.g., "TypeScript authentication middleware")
  - Signal 3: Risk signals from diff analysis (e.g., "error handling, null checks, input validation" -- the existing `riskSignals` array from `analyzeDiff`)
  - Combine into: "TypeScript authentication bug fix: error handling, null checks in auth middleware"
- Use the existing `diffAnalysis.riskSignals` array (already computed at line 1356) to add semantic meaning to the query. Risk signals describe WHAT might be wrong, which aligns with finding descriptions.
- Consider separate queries for different retrieval intents: one for "findings on similar files" (file-path-based) and one for "findings on similar issues" (risk-signal-based). Merge and deduplicate results.
- Implement retrieval quality measurement: after a review completes, compare retrieved findings against actual findings produced. Track relevance metrics (was the retrieved finding in the same category/severity as any actual finding?). Use this to tune the distance threshold empirically.
- For language-aware boosting: when the PR is 80%+ TypeScript, prefer historical findings from TypeScript files. The memory store's vec0 table already has `category` as a partition key -- consider adding language as a filter.

**Detection:**
- Retrieval results consistently at the distance threshold boundary (indicates poor semantic match -- results are barely passing).
- Retrieved findings are in a different category/severity distribution than the review's actual findings.
- Retrieval returns 0 results for repos with 50+ stored findings (indicates query is in wrong semantic space).
- High retrieval result count but LLM ignores all retrieved context (indicates low relevance).

**Phase to address:**
Intelligent retrieval improvements phase -- query construction is the highest-leverage improvement. Must be designed before threshold tuning, because better queries change the optimal threshold.

---

## Moderate Pitfalls

Mistakes that cause significant rework or degraded user experience but are recoverable.

---

### Pitfall 6: Dependency Bump Analysis Generates Noise on Routine Updates

**What goes wrong:**
A Dependabot PR bumps 8 dev dependencies (eslint plugins, prettier, type definitions). The dependency analysis feature produces 8 sections of changelog summaries, advisory checks, and breaking change assessments. The review comment is now 3000+ characters of dependency analysis before any code review findings. For a routine `@types/node` patch bump, this is pure noise. The user scrolls past it, and in the process, misses the one meaningful item: a breaking change in an eslint plugin that requires config updates.

**Why it happens:**
The feature treats all dependency bumps equally. A `@types/node` patch bump and a `react` major version bump get the same analysis depth. Without categorization, the system cannot distinguish signal from noise.

**Consequences:**
- Users learn to skip the dependency analysis section entirely, missing important warnings.
- Review comments become excessively long, reducing readability of code review findings.
- LLM token cost increases for changelog/advisory context that adds no value.
- Dependabot/Renovate PRs (which already describe the bump) get redundant information.

**Prevention:**
- Categorize bumps by impact: (1) major version bumps always get full analysis, (2) minor bumps get changelog summary only, (3) patch bumps get advisory check only (no changelog), (4) dev dependency patch bumps get a single-line summary.
- Detect Dependabot/Renovate PRs by author (`dependabot[bot]`, `renovate[bot]`) or PR labels (`dependencies`). These PRs already include changelog information in their body -- do not duplicate it.
- Set a budget: maximum N dependency analyses per review (e.g., 5 most impactful). Group remaining bumps as "N other dependencies updated (all patch)."
- Separate dependency analysis from code review findings. Use a collapsible `<details>` section or a separate comment. The existing review structure has a summary comment and inline comments -- dependency analysis should be in the summary, not mixed with findings.
- Allow repos to opt out of dependency analysis for specific packages or scopes: `review.dependencyAnalysis.skipPackages: ["@types/*", "eslint-*"]`.

**Detection:**
- Dependency analysis section exceeds 2000 characters in the review summary.
- User feedback (thumbs-down) rate is higher on dependency-bump PRs than on code PRs.
- More than 5 dependency bumps analyzed in a single review.

**Phase to address:**
Dependency bump analysis phase -- categorization and budget must be designed before output formatting.

---

### Pitfall 7: Breaking Change Detection Has High False Positive Rate

**What goes wrong:**
The dependency analysis reports "BREAKING CHANGE detected" for a minor version bump. The detection logic found the word "breaking" in the changelog, but it was in the context of "breaking: fixed a previously broken behavior" or "this change is non-breaking." Alternatively, the semver major bump is flagged as breaking, but the breaking change is in an API that the project does not use.

Dependabot and Renovate's own research shows that tests can only detect 47% of direct and 35% of indirect artificial faults on average. Breaking change detection through changelog parsing is even less reliable than test detection.

**Why it happens:**
"Breaking change" detection from text is a natural language understanding problem, not a string matching problem. The word "breaking" appears in many contexts. Semver convention says major bumps MAY contain breaking changes, but not all major bumps break the consumer's usage. Without understanding which APIs the project actually uses, any breaking change report is speculative.

**Consequences:**
- False "BREAKING CHANGE" warnings on routine bumps train users to ignore the warning.
- When an actual breaking change occurs, the user ignores it because the previous 10 warnings were false.
- "Crying wolf" destroys the credibility of the entire dependency analysis feature.

**Prevention:**
- Never use "BREAKING CHANGE" as a definitive label. Use "Potential breaking change" with evidence: "Version 2.0.0 is a major bump. Changelog mentions: 'Removed support for Node 14.'" The user decides if it is relevant.
- For semver: major bump = "This is a major version update. Review changelog for breaking changes." Minor/patch bump = do not flag as potentially breaking unless the changelog explicitly says so.
- For changelog text: use pattern matching that requires surrounding context. Match `BREAKING CHANGE:` (Conventional Commits format) or `## Breaking Changes` (Keep a Changelog format), not just the word "breaking" anywhere.
- Cross-reference: if the project's `package.json` or import map references specific APIs from the bumped package, and the changelog mentions those APIs as changed, increase confidence. Otherwise, flag as low-confidence.
- Include the evidence source: "Source: GitHub Release notes" or "Source: CHANGELOG.md" so users can verify.

**Detection:**
- User manually overrides or dismisses breaking change warnings repeatedly.
- Breaking change flags on patch bumps (should never happen without exceptional evidence).
- More than 3 breaking change flags in a single dependency-bump PR.

**Phase to address:**
Dependency bump analysis phase -- breaking change confidence levels must be part of the initial design.

---

### Pitfall 8: Adaptive Distance Threshold Creates Unpredictable Retrieval Behavior

**What goes wrong:**
The intelligent retrieval improvement adds adaptive thresholds: when the memory store has few entries (new repo), use a looser threshold to return any available context; when the store is mature, use a tighter threshold for precision. But the threshold adaptation creates a non-obvious behavior change: as a repo accumulates findings, the retrieval suddenly starts returning fewer results (tighter threshold kicks in). Users who relied on seeing "Based on prior reviews..." context stop seeing it, with no explanation.

Worse: the threshold may adapt per-query based on result density. A query returning 20 candidates within distance 0.5 gets a tighter threshold than a query returning 2 candidates. This makes retrieval results non-deterministic from the user's perspective: similar PRs get different retrieval context based on what is already in the store.

**Why it happens:**
Static thresholds are suboptimal -- the ideal threshold depends on the data distribution, which changes as the store grows. But adaptive thresholds trade one problem (static suboptimality) for another (unpredictability). Users cannot understand or debug why retrieval behaves differently on different PRs.

**Consequences:**
- Users report "the bot used to show prior findings but stopped" (threshold tightened as store grew).
- Same repo, similar PRs, different retrieval results -- inconsistency damages trust.
- Debugging retrieval issues requires understanding the threshold adaptation algorithm, which is not exposed to users.
- If the adaptation is too aggressive, mature repos get very few retrieval results despite having rich history.

**Prevention:**
- Use a fixed default threshold with a configurable override: `knowledge.retrieval.distanceThreshold: 0.45` (already exists in config). Do not add automatic adaptation in v0.9. Instead, improve query quality (Pitfall 5) which has higher leverage.
- If adaptive thresholds are implemented later, add them as opt-in: `knowledge.retrieval.adaptiveThreshold.enabled: false` (default false).
- Always log the effective threshold and result count in retrieval provenance (the existing `provenance` object in `RetrievalWithProvenance`). This enables debugging.
- If adaptation is added, base it on the REPO's store maturity (total non-stale records), not per-query result density. Repo maturity is stable across queries; per-query density is not.
- Define clear bands: <50 memories = "early" (threshold 0.55), 50-500 = "growing" (threshold 0.45), 500+ = "mature" (threshold 0.35). These are tuned once and documented.

**Detection:**
- Retrieval result count drops significantly after repo accumulates N findings (threshold transition).
- Same PR reviewed twice shows different retrieval results (non-determinism from density-based adaptation).
- Users file issues about "prior finding context disappeared."

**Phase to address:**
Intelligent retrieval improvements phase -- keep fixed threshold for v0.9, improve queries instead. Flag adaptive thresholds for v1.0+ with empirical data from improved queries.

---

### Pitfall 9: Embedding Model Drift Silently Degrades Retrieval Quality

**What goes wrong:**
Voyage AI updates their embedding model (e.g., `voyage-code-3` to `voyage-code-4`). The codebase already handles model changes via `markStale` (line 182 of memory-store.ts) which marks all embeddings from the old model as stale, and `purgeStaleEmbeddings` which deletes them. But the transition period is dangerous: after a model change, ALL existing embeddings are stale. The store is effectively empty until new findings are written with the new model. For repos with 500+ historical findings, this means months of accumulated learning are instantly lost.

Even without an explicit model change, Voyage AI could update the model weights behind the same model ID (they have done this historically for some models). The embeddings for new documents would be in a slightly different vector space than old documents, degrading similarity search quality without any visible signal.

**Why it happens:**
The existing `markStale` mechanism assumes a model version change is detectable. But silent model updates (same model ID, different weights) are not detectable. Even with detectable changes, the purge-all-and-rebuild approach loses all historical context until new findings accumulate.

**Consequences:**
- After a model upgrade, retrieval returns zero results for weeks/months until new findings rebuild the store.
- Silent model drift causes retrieval quality to gradually degrade -- stored embeddings from the old model variant are compared against queries from the new variant, producing meaningless distances.
- Users see irrelevant "prior findings" context because the distance metric is miscalibrated (old embedding + new embedding comparison).

**Prevention:**
- Pin the exact Voyage AI model version in config (already done: `knowledge.embedding.model`). If Voyage AI introduces a new model, the upgrade is a deliberate config change, not automatic.
- When a model change is detected, do NOT purge immediately. Instead, re-embed existing records in batches (background job). Mark old embeddings as stale only after re-embedding completes. This preserves continuity.
- Monitor embedding quality: periodically (e.g., weekly) pick a random sample of 10 stored records, re-embed them with the current model, and compare the new embedding against the stored embedding using cosine distance. If the self-distance exceeds a threshold (e.g., 0.1), the model has drifted. Alert the operator.
- The existing `embeddingDim` field in `learning_memories` table provides a sanity check: if the new model has different dimensions than stored records, it is an obvious incompatibility. But same-dimension models can still drift.
- For the v0.9 improvement: add a `embedding_model_version` field to the `learning_memories` table (or use the existing `embedding_model` field more precisely) and include a model version hash in the provenance log.

**Detection:**
- Self-distance check: re-embed a stored record and compare against stored embedding. Distance > 0.1 = drift.
- Retrieval result quality degrades over time (measured by the relevance metric from Pitfall 5's detection strategy).
- Retrieval returns results at the distance threshold boundary that were previously well within threshold.

**Phase to address:**
Intelligent retrieval improvements phase -- drift detection is a monitoring concern. The re-embedding migration strategy should be designed but can be implemented incrementally.

---

### Pitfall 10: Timeout Resilience Changes the Review's Error Semantics

**What goes wrong:**
The current system has clean error semantics: a review either succeeds (findings published) or fails (error comment posted via `postOrUpdateErrorComment`). The `classifyError` function in errors.ts maps errors to user-friendly categories. Timeout is handled as a failure with a "try breaking the task into smaller pieces" suggestion.

Chunked/progressive review introduces a new semantic: "partial success." The review partially completed, some findings were identified, but the review is incomplete. The existing error classification has no "partial_success" category. If partial results are published with a "review timed out" error comment, users see findings + an error message. They do not know: (1) were all high-risk files reviewed? (2) are there findings that the bot would have reported if it had more time? (3) should they request a re-review or is this "good enough"?

**Why it happens:**
The `ExecutionResult` type in types.ts has `conclusion: "success" | "failure" | "error"` -- there is no "partial" state. The review handler's post-execution logic (finding extraction, enforcement, suppression) assumes a complete review. Partial results may have findings from high-risk files but miss findings from medium-risk files, creating an inconsistent quality level.

**Consequences:**
- Users see findings + error message and do not know if the review is complete.
- The knowledge store records the review with findings, but the head SHA is recorded as "reviewed" -- subsequent incremental reviews assume the full file set was covered.
- Delta re-review shows "new findings" that are actually "previously missed due to timeout" -- confusing.
- Feedback collected on partial reviews pollutes the learning memory with skewed data (only high-risk files were reviewed).

**Prevention:**
- Add a `partial` conclusion to ExecutionResult: `conclusion: "success" | "failure" | "error" | "partial"`.
- When publishing partial results, clearly communicate incompleteness: "Reviewed 15 of 42 files (review timed out). High-risk files were prioritized. Re-request review for a complete analysis."
- When recording partial reviews in the knowledge store, store the list of files actually reviewed. Incremental diff computation should compare against this list, not assume all files were covered.
- Do NOT collect learning memory data from partial reviews. The finding set is biased toward high-risk files and does not represent the full review quality.
- Add a `coveredFiles` field to the review record: for complete reviews, this is all changed files; for partial reviews, this is only the files that were in the prompt. Incremental diff uses this for accurate delta computation.

**Detection:**
- `conclusion: "partial"` reviews that are later followed by a full review showing many "new" findings on the same PR.
- Incremental re-review finds issues on files that were in the original PR but not reviewed due to timeout.
- Users request re-review immediately after a partial review (indicates dissatisfaction with partial output).

**Phase to address:**
Timeout resilience phase -- partial result semantics must be designed alongside the chunking strategy. The ExecutionResult type change has downstream effects on telemetry, knowledge store, and delta classification.

---

## Minor Pitfalls

Mistakes that cause friction but are quickly fixable.

---

### Pitfall 11: Package Lock File Parsing Misidentifies Dependency Bumps

**What goes wrong:**
The dependency analysis detects bumps by parsing lock file changes (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`). But lock file diffs are noisy: a single `npm install` can change hundreds of transitive dependency versions without any change to `package.json`. The analysis flags all of these as "dependency bumps" even though the developer only intentionally changed one or two packages.

**Why it happens:**
Lock files record the entire resolved dependency tree. Transitive dependency updates cascade: bumping `react` may change 40 transitive dependencies. Parsing the lock file diff without cross-referencing `package.json` changes misattributes transitive updates as intentional bumps.

**Prevention:**
- Always cross-reference lock file changes against `package.json` (or equivalent manifest) changes. Only analyze packages that changed in BOTH files (intentional bumps). Transitive changes get a single summary line: "12 transitive dependencies updated."
- For PRs that only change lock files (e.g., `npm audit fix`), summarize the advisory resolutions rather than analyzing each transitive bump.
- If `package.json` is not in the changed files but the lock file is, flag it: "Lock file updated without manifest change -- likely a transitive dependency update or `npm install` refresh."

**Detection:**
- More than 10 dependency bumps analyzed in a single review (likely includes transitive).
- Lock file in changed files but `package.json` not in changed files.

**Phase to address:**
Dependency bump analysis phase -- lock file vs manifest cross-referencing must be part of the bump detection logic.

---

### Pitfall 12: Language-Aware Retrieval Boosting Penalizes Polyglot Repos

**What goes wrong:**
The retrieval improvement adds language-aware boosting: prefer historical findings from the same language as the current PR. But polyglot repos (TypeScript + Python + Go) have mixed-language PRs. A PR changing both `auth.ts` and `auth.py` gets TypeScript-biased retrieval (if TypeScript is the majority language), missing relevant Python-specific findings from history.

**Prevention:**
- Do not boost by majority language. Instead, retrieve findings for each language present in the PR and merge results. The existing `classifyLanguages` function in diff-analysis.ts already classifies files by language.
- Weight results by the proportion of files in each language in the current PR: if 70% TypeScript and 30% Python, weight TypeScript results 70% and Python results 30% in the final merged list.
- If language boosting is used, apply it as a tie-breaker (same distance, prefer same language), not as a primary filter.

**Detection:**
- Retrieval returns findings only from one language in a multi-language PR.
- Repos with mixed-language PRs have lower retrieval relevance than single-language repos.

**Phase to address:**
Intelligent retrieval improvements phase -- language-aware boosting design should account for polyglot repos from the start.

---

### Pitfall 13: Changelog Fetching Leaks Private Repository Information

**What goes wrong:**
A dependency's `repository` field in npm metadata points to a private GitHub repository. The changelog fetching logic attempts to access this URL, fails with a 404/403, and logs the URL including the private repo path. If the log is accessible to users (via error comments or telemetry dashboards), it leaks the existence and path of private repositories.

**Prevention:**
- Never include raw GitHub URLs in user-facing output or error messages from changelog fetching. Sanitize URLs to remove path components beyond `owner/repo`.
- Treat all changelog fetch failures as "changelog unavailable" without revealing the failed URL. Log the full URL at debug level only.
- Do not use the GitHub installation token for changelog fetching on external repositories. Use unauthenticated requests (limited but safe) or a separate, unprivileged token. The installation token has access to the repos it is installed on -- using it to fetch external repos could expose private repo metadata.

**Detection:**
- Changelog fetch errors that include full GitHub URLs in user-facing output.
- Installation token used for requests to repos outside the installation scope.

**Phase to address:**
Dependency bump analysis phase -- URL sanitization and token scoping must be addressed during implementation.

---

### Pitfall 14: Timeout Budget Does Not Account for Pre-Review Pipeline Time

**What goes wrong:**
The current `timeoutSeconds` config (default 600) is applied to the executor's Claude Agent SDK call. But the review handler performs significant work BEFORE executor invocation: workspace creation + git clone (5-30 seconds for large repos), config loading, intent parsing, author classification, incremental diff computation, diff collection, diff analysis, risk scoring, file triage, prior finding dedup, and retrieval context generation. For large repos like xbmc, pre-executor pipeline time can consume 30-60 seconds. The actual LLM execution gets 540-570 seconds of the 600 second budget. If the total wallclock time exceeds 600 seconds, the user perceives a timeout even though the executor technically had adequate time.

**Prevention:**
- Track pre-executor pipeline time as a separate metric. Log it prominently: "Pre-review pipeline: 45 seconds. Executor budget: 555 seconds."
- Consider a total wallclock timeout (covering the entire handleReview function) in addition to the executor timeout. The executor timeout stays as-is (prevents runaway LLM calls), but a separate total timeout prevents the queue from holding a job indefinitely.
- For timeout resilience: the "reduced scope" retry should subtract the pre-executor time from the timeout budget. If pre-executor takes 45 seconds and total budget is 600, the retry's executor timeout should be 555 seconds, not 600.

**Detection:**
- Total wallclock time exceeds timeoutSeconds even though executor did not timeout.
- Pre-executor pipeline time exceeds 60 seconds (indicates large repo or slow API responses).

**Phase to address:**
Timeout resilience phase -- budget accounting is needed for accurate timeout reporting and retry scheduling.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| Dependency bump analysis | Changelog fetch fails for 30-50% of packages (P1) | CRITICAL | Multi-source cascade with compare URL fallback, time budget, cache |
| Dependency bump analysis | CVE data false positives/negatives (P2) | CRITICAL | Use OSV.dev, frame as "advisory" not "vulnerability", confidence signals |
| Dependency bump analysis | Noise on routine updates (P6) | MODERATE | Categorize by impact, budget per review, separate section |
| Dependency bump analysis | Breaking change false positives (P7) | MODERATE | "Potential" framing, evidence-based, Conventional Commits patterns only |
| Dependency bump analysis | Lock file transitive noise (P11) | MINOR | Cross-reference manifest changes, summarize transitives |
| Dependency bump analysis | Private repo URL leak (P13) | MINOR | Sanitize URLs, unprivileged token for external repos |
| Timeout resilience | Duplicate comments from chunks (P3) | CRITICAL | Progressive reduction instead of parallel chunks, single publish point |
| Timeout resilience | Race condition with in-flight MCP calls (P4) | CRITICAL | Cooldown + idempotency check before retry, track published IDs |
| Timeout resilience | Partial result error semantics (P10) | MODERATE | Add "partial" conclusion, communicate incompleteness, track covered files |
| Timeout resilience | Budget does not account for pipeline time (P14) | MINOR | Track pre-executor time, total wallclock timeout |
| Intelligent retrieval | Naive query construction (P5) | CRITICAL | Multi-signal queries using risk signals + language + conventional type |
| Intelligent retrieval | Adaptive threshold unpredictability (P8) | MODERATE | Keep fixed threshold for v0.9, improve queries instead |
| Intelligent retrieval | Embedding model drift (P9) | MODERATE | Pin model version, drift detection sampling, batch re-embedding |
| Intelligent retrieval | Language boosting penalizes polyglot repos (P12) | MINOR | Retrieve per-language, merge proportionally, boost as tie-breaker only |

## Integration Pitfalls: Feature Interactions

These pitfalls emerge from the interaction between v0.9 features and with existing v0.1-v0.8 infrastructure.

| Interaction | What Goes Wrong | Prevention |
|-------------|----------------|------------|
| Dependency analysis + large PR triage | A dependency-bump PR touches 5 source files + 200 lock file lines. Large PR triage kicks in (200+ files when lock file is counted as one large file). The triage system demotes the source files to abbreviated tier because the overall PR "size" is dominated by the lock file. Source files get shallow review while dependency analysis adds noise. | Exclude lock files from file count for triage threshold calculation. Lock files should be analyzed by dependency analysis, not by the code review pipeline. Add lock file patterns to the triage exclusion list. |
| Dependency analysis + incremental re-review | First review catches a vulnerability advisory for package X. User pushes a commit updating X to a fixed version. Incremental re-review only reviews files changed since last review -- but the dependency analysis should re-evaluate package X. If dependency analysis is tied to the code review pipeline, it may not re-run if the lock file was not in the incremental changed-files set. | Run dependency analysis against the full current state, not the incremental delta. Dependency advisories are a snapshot-in-time assessment, not a diff-based assessment. |
| Timeout resilience + retrieval context | The retrieval query is generated before executor invocation. It adds retrieved findings to the prompt, increasing its token count. For large PRs already near the timeout boundary, the additional tokens from retrieval context push the LLM into more turns, causing a timeout that would not have occurred without retrieval. | Track the marginal cost of retrieval context (additional tokens). If the PR is already classified as large (`tieredFiles.isLargePR`), reduce retrieval topK or disable retrieval entirely to preserve timeout budget. |
| Timeout resilience + knowledge store recording | A partial review publishes findings for 15 of 42 files. The knowledge store records the head SHA as "reviewed." On the next push, incremental diff computes delta from this SHA. Files 16-42 were never reviewed but are marked as covered. Findings on those files are not surfaced in the incremental re-review. | When recording a partial review, store `coveredFiles` alongside `headSha`. Incremental diff should only consider files in `coveredFiles` as previously reviewed, not all files from the PR at that SHA. |
| Intelligent retrieval + dependency bump PRs | A Dependabot PR bumps 5 packages. The retrieval query includes file paths like `package.json`, `package-lock.json`. These paths are in every dependency bump PR, causing retrieval to return findings from ALL previous dependency PRs regardless of which packages changed. The retrieval results are dominated by lock file path matches. | When constructing retrieval queries for dependency bump PRs (detected by author or label), exclude lock file paths and use package names instead: "react 18->19 upgrade, authentication middleware" rather than "package.json, package-lock.json". |
| Embedding quality + growing memory store | As the memory store grows beyond 1000 entries, sqlite-vec's approximate nearest neighbor search introduces accuracy trade-offs. The vec0 virtual table uses an exact KNN implementation for small datasets but may need index tuning for larger datasets. The current implementation uses default parameters. | Monitor retrieval latency as the store grows. If latency exceeds 50ms per query, investigate vec0 index parameters. For v0.9, add retrieval latency to telemetry. The current prepared statement (line 165 of memory-store.ts) uses vec0's default search -- ensure this scales to 10K+ records. |

## Pitfall-to-Phase Mapping

| Pitfall | ID | Severity | Prevention Phase | Verification Criteria |
|---------|----|----------|------------------|-----------------------|
| Changelog fetch unreliability | P1 | CRITICAL | Dependency analysis | Changelog hit rate > 50%. Fallback compare URL always produced. Per-dependency fetch < 2s. Total fetch budget < 5s. |
| CVE data false positives | P2 | CRITICAL | Dependency analysis | OSV.dev as primary source. "Advisory" framing (never "vulnerability detected"). Confidence level shown on every advisory. Zero false "VULNERABILITY DETECTED" labels. |
| Duplicate comments from chunks | P3 | CRITICAL | Timeout resilience | No duplicate inline comments on any PR. Single publish point per review attempt. Idempotency check before any publish. |
| Race condition with in-flight MCP | P4 | CRITICAL | Timeout resilience | Cooldown between timeout and retry. Idempotency check passes before retry publish. Published comment IDs tracked. |
| Naive query construction | P5 | CRITICAL | Retrieval improvements | Query includes risk signals and language context. Retrieval relevance measured (retrieved findings match actual finding categories > 40% of the time). |
| Routine update noise | P6 | MODERATE | Dependency analysis | Max 5 full dependency analyses per review. Patch dev-deps get one-line summary. Dependabot PRs get reduced analysis. |
| Breaking change false positives | P7 | MODERATE | Dependency analysis | "Potential" framing used (never definitive "BREAKING"). Evidence source included. No breaking flags on patch bumps. |
| Adaptive threshold unpredictability | P8 | MODERATE | Retrieval improvements | Fixed threshold for v0.9. Threshold value logged in provenance. Result count does not drop > 50% between consecutive reviews on same repo. |
| Embedding model drift | P9 | MODERATE | Retrieval improvements | Model version pinned in config. Drift detection sampling implemented (weekly). Stale records batch re-embedded, not purged-and-lost. |
| Partial result semantics | P10 | MODERATE | Timeout resilience | "partial" conclusion added to ExecutionResult. Partial reviews clearly communicate incompleteness. coveredFiles tracked in knowledge store. |
| Lock file transitive noise | P11 | MINOR | Dependency analysis | Manifest cross-reference implemented. Transitive changes summarized in one line. |
| Polyglot retrieval bias | P12 | MINOR | Retrieval improvements | Multi-language PRs retrieve findings from all languages present. Language used as tie-breaker, not primary filter. |
| Private repo URL leak | P13 | MINOR | Dependency analysis | No full external URLs in user-facing output. Changelog fetch uses unprivileged requests for external repos. |
| Budget accounting gap | P14 | MINOR | Timeout resilience | Pre-executor pipeline time tracked. Total wallclock time available for debugging. Retry budget adjusted for pipeline overhead. |

## Prioritized Risk Register

| Priority | Pitfall | Impact | Probability | Rationale |
|----------|---------|--------|-------------|-----------|
| P0 | Naive query construction (P5) | High | Very High | The current query is demonstrably weak (title + file paths vs finding descriptions). Every retrieval call is suboptimal. Highest leverage improvement in v0.9. |
| P0 | CVE false positives (P2) | Very High | High | NVD data quality is empirically poor (20K false positives documented). Wrong advisory data is worse than no data -- it destroys trust and creates false safety. |
| P0 | Duplicate comments from chunks (P3) | High | High | Any chunked review implementation that publishes incrementally WILL produce duplicates without per-chunk idempotency. The existing architecture does not support partial publish state. |
| P1 | Changelog unreliability (P1) | High | Very High | 30-50% of packages lack accessible changelogs. Without a graceful fallback cascade, half of dependency analyses show "no data." |
| P1 | Race condition with in-flight MCP (P4) | High | Medium | Occurs when timeout fires during MCP tool execution. Medium probability because MCP calls are fast (single API call), but when it hits, the consequences (duplicate publish, stale state) are severe. |
| P1 | Routine update noise (P6) | Medium | High | Every Dependabot/Renovate PR will trigger noise if dependency analysis treats all bumps equally. High probability because dependency-bump PRs are common. |
| P2 | Breaking change false positives (P7) | Medium | High | Text-based "breaking" detection produces false positives frequently. Mitigated by "potential" framing. |
| P2 | Partial result semantics (P10) | Medium | Medium | Only affects repos that experience timeouts (currently 10% on large repos). Impact grows as timeout resilience enables partial results by design. |
| P2 | Embedding drift (P9) | Medium | Low | Only triggers on model version change or silent update. Voyage AI models are generally stable. Mitigated by version pinning. |
| P3 | Adaptive threshold unpredictability (P8) | Low | Medium | Only relevant if adaptive thresholds are implemented (recommendation: skip for v0.9). |
| P3 | Lock file noise (P11) | Low | Medium | Only affects PRs with lock file changes. Easily fixed with manifest cross-reference. |
| P3 | Polyglot retrieval bias (P12) | Low | Low | Only affects polyglot repos with mixed-language PRs. Uncommon but addressable. |
| P3 | Private repo URL leak (P13) | Low | Low | Only affects packages with private repo metadata. URL sanitization is straightforward. |
| P3 | Budget accounting gap (P14) | Low | Medium | Causes slightly misleading timeout messages. Not functionally dangerous. |

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Changelog unreliability (P1) | LOW | (1) Add compare URL fallback. (2) Add cache layer. No data migration needed. |
| CVE false positives (P2) | MEDIUM | (1) Switch from NVD to OSV.dev. (2) Add confidence framing to output templates. (3) Audit existing advisory output for false-positive patterns. |
| Duplicate comments (P3) | MEDIUM | (1) Add per-chunk idempotency or switch to progressive reduction. (2) Clean up duplicate comments on affected PRs via API. (3) Add duplicate detection to finding extraction. |
| Race condition (P4) | LOW | (1) Add cooldown + idempotency check. Deploy immediately. (2) Clean up any stale partial reviews. |
| Naive queries (P5) | LOW | (1) Update `queryText` construction to include risk signals. Pure code change, no data migration. (2) Existing embeddings are unaffected (queries change, documents stay). |
| Routine noise (P6) | LOW | (1) Add categorization logic. (2) Add budget enforcement. No infrastructure changes. |
| Breaking change false positives (P7) | LOW | (1) Change label from definitive to "potential." (2) Add evidence source. Template change only. |
| Partial result semantics (P10) | MEDIUM | (1) Add "partial" conclusion to type. (2) Update all consumers (telemetry, knowledge store, error handling). (3) Add coveredFiles tracking. Requires type migration across codebase. |

## Sources

### Primary (HIGH confidence)
- Kodiai codebase analysis: `src/execution/executor.ts` (timeout enforcement, AbortController, MCP tool publishing), `src/handlers/review.ts` (review pipeline, retrieval query construction, finding extraction, incremental diff, large PR triage), `src/learning/memory-store.ts` (vec0 virtual table, embedding storage, stale marking), `src/learning/isolation.ts` (retrieval with provenance, distance threshold filtering), `src/learning/embedding-provider.ts` (Voyage AI client, fail-open semantics), `src/lib/errors.ts` (error classification, timeout handling), `src/execution/config.ts` (Zod schemas, timeoutSeconds, retrieval config)
- [Renovate changelog fetching docs](https://docs.renovatebot.com/key-concepts/changelogs/) -- multi-source changelog resolution, GraphQL API requirement, package registry metadata gaps
- [Sonatype: The CVE Crisis (2025)](https://www.sonatype.com/resources/research/the-cve-crisis) -- 20K false positives, 150K false negatives, 64% unscored CVEs, 6-week average NVD scoring delay
- [Sonatype: Vulnerability Scoring Gaps Report (2025)](https://www.helpnetsecurity.com/2025/11/24/sonatype-vulnerability-scoring-gaps-report/) -- 19% severity alignment, 62% overstated severity
- [Google OSV.dev (2025)](https://github.com/google/osv.dev) -- disputed CVE handling, 50% NVD conversion rate, data quality improvements

### Secondary (MEDIUM confidence)
- [ScienceDirect: Can we trust tests to automate dependency updates?](https://www.sciencedirect.com/science/article/pii/S0164121221001941) -- tests detect 47% of direct faults, 35% of indirect faults in dependency updates
- [Weaviate: When Good Models Go Bad](https://weaviate.io/blog/when-good-models-go-bad) -- embedding drift detection, model versioning, operational monitoring
- [Voyage AI: voyage-3-large announcement (2025)](https://blog.voyageai.com/2025/01/07/voyage-3-large/) -- Matryoshka learning, dimension reduction, quantization-aware training
- [npm-fetch-changelog](https://www.npmjs.com/package/npm-fetch-changelog) -- GitHub Release fallback to CHANGELOG.md parsing approach
- [Renovate GitHub Discussion #14745](https://github.com/renovatebot/renovate/discussions/14745) -- supplying source/changelog URLs, registry metadata gaps
- [Google OSV: Disputed CVE fix (2025)](https://socket.dev/blog/google-osv-fix-adds-500-new-advisories) -- 500+ advisories restored after policy change on disputed CVEs

### Tertiary (LOW confidence)
- General LLM timeout handling patterns from production AI systems (training data, not verified against specific implementations)
- sqlite-vec scaling characteristics for 10K+ record datasets (documented as exact KNN, not ANN, but performance at scale needs empirical validation)

---
*Pitfalls research for: Kodiai v0.9 -- Dependency Bump Analysis, Timeout Resilience, Intelligent Retrieval*
*Researched: 2026-02-14*
*Supersedes: 2026-02-13 v0.8 pitfalls research (different feature scope)*
