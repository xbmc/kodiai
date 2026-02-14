# Technology Stack

**Project:** Kodiai -- Language-Aware Enforcement, Large PR Intelligence, Feedback-Driven Learning
**Researched:** 2026-02-13
**Overall Confidence:** HIGH

## Executive Summary

This milestone adds three capabilities to an existing, mature codebase: (1) language-specific severity rules that distinguish auto-fixable from safety-critical findings, (2) risk-weighted file prioritization for large PRs, and (3) thumbs-down reaction feedback with auto-suppression. The critical finding from this research is that **zero new dependencies are needed**. Every capability can be built using existing libraries, existing SQLite schema patterns, existing diff analysis infrastructure, and existing GitHub API methods already verified in the codebase.

The "stack" for this milestone is overwhelmingly about **data structures, heuristics, and configuration schema extensions** -- not new libraries. The existing `diff-analysis.ts` already classifies files by language and category. The existing `feedback-sync.ts` already polls reactions via `octokit.rest.reactions.listForPullRequestReviewComment`. The existing `confidence.ts` already scores findings by severity and category. Each new feature extends these foundations with additional logic, not additional dependencies.

## Recommended Stack

### No New Dependencies Required

| What's Needed | Already Available | Where |
|---------------|-------------------|-------|
| Language classification | `EXTENSION_LANGUAGE_MAP` (20 languages) | `src/execution/diff-analysis.ts` |
| Language-specific rules | `LANGUAGE_GUIDANCE` (9 languages with detailed rules) | `src/execution/review-prompt.ts` |
| File risk heuristics | `PATH_RISK_SIGNALS`, `CONTENT_RISK_SIGNALS`, `analyzeDiff()` | `src/execution/diff-analysis.ts` |
| Numstat parsing (lines changed per file) | `parseNumstat()` | `src/execution/diff-analysis.ts` |
| File category classification | `DEFAULT_FILE_CATEGORIES` with picomatch | `src/execution/diff-analysis.ts` |
| Git churn data | `git log --numstat` via Bun shell `$` | `src/handlers/review.ts` |
| Reaction polling | `octokit.rest.reactions.listForPullRequestReviewComment()` | `src/handlers/feedback-sync.ts` |
| Reaction storage | `feedback_reactions` table with `UNIQUE(repo, comment_id, reaction_id)` | `src/knowledge/store.ts` |
| Finding-to-comment correlation | `comment_id`, `comment_surface`, `review_output_key` on findings | `src/knowledge/types.ts` |
| Confidence scoring | `computeConfidence()` with severity/category boosts | `src/knowledge/confidence.ts` |
| Suppression matching | `matchesSuppression()` with glob/regex patterns | `src/knowledge/confidence.ts` |
| Configuration schema | Zod schemas with section fallback parsing | `src/execution/config.ts` |
| Prompt injection | `buildReviewPrompt()` with conditional sections | `src/execution/review-prompt.ts` |
| Embedding-backed learning | `LearningMemoryStore` + `sqlite-vec` + Voyage AI | `src/learning/memory-store.ts` |

### Existing Dependencies (No Version Changes)

| Technology | Version | Purpose | Used For New Features |
|------------|---------|---------|----------------------|
| `bun:sqlite` | builtin | Persistent storage | New tables/columns for feedback aggregation and risk scores |
| `picomatch` | ^4.0.2 | Glob pattern matching | File path matching in language rules and risk signals |
| `@octokit/rest` | ^22.0.1 | GitHub API | Reaction polling (already used by feedback-sync) |
| `zod` | ^4.3.6 | Schema validation | Config schema extensions for language rules |
| `pino` | ^10.3.0 | Structured logging | Feedback loop and risk scoring telemetry |
| `p-queue` | ^9.1.0 | Concurrency control | Rate-limited reaction sync jobs |
| `sqlite-vec` | ^0.1.7-alpha.2 | Vector similarity search | Feedback-to-learning-memory integration |
| `voyageai` | ^0.1.0 | Embedding generation | Thumbs-down finding embedding for suppression retrieval |
| `hono` | ^4.11.8 | HTTP framework | No changes needed |

## Feature-Specific Stack Details

### Feature 1: Language-Specific Severity Rules

**Approach: Prompt-driven enforcement with heuristic classification, NOT linter integration.**

Why NOT run linters (ESLint, Ruff, Clippy) programmatically:

| Approach | Complexity | Why Reject |
|----------|------------|------------|
| Run ESLint/Ruff/Clippy in workspace | HIGH | Requires installing per-language toolchains in every cloned workspace, managing linter configs per repo, handling version mismatches, and processing structured output. Adds 10-30s per review. |
| Parse `.eslintrc`/`pyproject.toml` from repo | MEDIUM | Config parsing for 9+ linters is brittle, and the auto-fixable ruleset changes across versions. |
| Maintain static auto-fixable rule database | MEDIUM | Requires constant maintenance as linters evolve. Becomes stale within months. |
| **Classify via known patterns in prompt** | **LOW** | Extend existing `LANGUAGE_GUIDANCE` with auto-fixable vs safety-critical annotations. Let Claude's training knowledge determine what is auto-fixable. |

**Recommended approach:** Extend the existing `LANGUAGE_GUIDANCE` record in `review-prompt.ts` to partition rules into two tiers:

1. **Auto-fixable / formatter-territory**: Issues that linters or formatters can fix automatically (unused imports, formatting, missing semicolons, import ordering). These get **suppressed by default** or downgraded to MINOR.
2. **Safety-critical / language-specific**: Issues unique to the language's safety model (Go unchecked errors, Rust `.unwrap()` in production, C buffer overflows, Java unclosed resources). These get **upgraded to at minimum MAJOR**.

**What to build:**
- A `LanguageSeverityRule` type with `language`, `pattern`, `tier` ("auto-fixable" | "safety-critical"), and `severityOverride`
- A `LANGUAGE_SEVERITY_RULES` registry (static data, no external deps)
- Extension to `buildLanguageGuidanceSection()` to emit tiered instructions
- Config surface: `review.languageRules.suppressAutoFixable: boolean` (default: true)
- Config surface: `review.languageRules.enforceSafetyCritical: boolean` (default: true)

**What NOT to build:**
- Do NOT shell out to linters. The workspace may not have toolchains installed.
- Do NOT parse linter config files. Config formats vary across versions.
- Do NOT maintain an external database of fixable rules. Use prompt instructions instead.

**Confidence: HIGH** -- This extends existing patterns (`LANGUAGE_GUIDANCE`, `buildSeverityClassificationGuidelines()`) with zero new dependencies.

### Feature 2: Risk-Weighted File Prioritization for Large PRs

**Approach: Heuristic risk scoring using existing git data, NOT ML models or AST analysis.**

Why NOT use complexity analysis libraries:

| Approach | Complexity | Why Reject |
|----------|------------|------------|
| Cyclomatic complexity (ts-cyclomatic-complexity, CodeMetrics CLI) | HIGH | Requires parsing AST for every changed file across all languages. Most tools are TypeScript/JavaScript-only. Adds 5-15s per review. |
| ML-based risk prediction | VERY HIGH | Requires training data, model serving infrastructure. Massive overengineering for this use case. |
| **Heuristic scoring from git metadata** | **LOW** | Lines changed, file path signals, category, churn history -- all available from `git diff --numstat` and existing `analyzeDiff()`. |

**Recommended risk scoring formula:**

```
fileRisk = (linesChangedWeight * normalizedLinesChanged)
         + (pathRiskWeight * pathRiskSignalCount)
         + (categoryWeight * categoryRiskMultiplier)
         + (churnWeight * recentChurnCount)
```

Where:
- `normalizedLinesChanged` = `(added + removed) / maxLinesInPR` (0-1 range)
- `pathRiskSignalCount` = count of `PATH_RISK_SIGNALS` matching this file (already computed)
- `categoryRiskMultiplier` = source:1.0, infra:0.8, config:0.3, test:0.2, docs:0.1
- `recentChurnCount` = number of commits touching this file in recent history (from `git log --follow --oneline -- <file> | wc -l`)

**What to build:**
- A `computeFileRiskScore()` function in `diff-analysis.ts`
- Per-file numstat parsing (extend existing `parseNumstat()` to return per-file data)
- A `prioritizeFiles()` function that sorts files by risk score and applies budget allocation
- Budget allocation: for large PRs (>200 files or >5000 lines), allocate comment slots proportionally to risk score
- Extension to `buildDiffAnalysisSection()` to communicate prioritization to the prompt
- Config surface: `review.largePR.strategy: "risk-weighted" | "equal"` (default: "risk-weighted")
- Config surface: `review.largePR.maxAnalysisFiles: number` (default: 200)

**Git churn data collection:**
```typescript
// Already available: Bun shell $ is used extensively in review.ts
const churnResult = await $`git -C ${workspaceDir} log --oneline --follow -- ${filePath} | wc -l`.quiet().nothrow();
```

For large PRs, batch this as:
```typescript
// Single git command for all files' churn counts
const logResult = await $`git -C ${workspaceDir} log --name-only --pretty=format: --since="90 days ago"`.quiet().nothrow();
```

**What NOT to build:**
- Do NOT add AST parsing libraries. Too heavy for a review tool.
- Do NOT build per-language complexity analyzers. Cyclomatic complexity is a distraction -- lines changed + path signals are stronger predictors of review-worthy files.
- Do NOT add ML models for risk prediction. Heuristics are sufficient and debuggable.

**Confidence: HIGH** -- Uses only `git` commands and extends existing `analyzeDiff()` infrastructure.

### Feature 3: Thumbs-Down Reaction Feedback with Auto-Suppression

**Approach: Extend existing feedback-sync polling pipeline, NOT webhooks.**

**Critical verified constraint:** GitHub does NOT emit webhook events for reactions. This was verified against official GitHub webhook documentation (February 2026) and confirmed by the existing `feedback-sync.ts` which already uses a polling approach.

The existing system already has:
1. `feedback_reactions` table with `UNIQUE(repo, comment_id, reaction_id)` -- idempotent storage
2. `createFeedbackSyncHandler()` that polls reactions on PR activity events
3. `isHumanThumbReaction()` filter that excludes bots
4. `recordFeedbackReactions()` with `INSERT OR IGNORE` for dedup
5. Learning memory store with `outcome` field that already supports `"thumbs_down"`

**What to build (the NEW part -- auto-suppression from feedback):**

1. **Feedback aggregation query:** Count thumbs-down reactions per finding pattern (severity + category + title fingerprint) across a repo's history. When a pattern accumulates N thumbs-down reactions (configurable threshold, default 3), it becomes a candidate for auto-suppression.

2. **Feedback-derived suppression rules:** A new table or materialized query that produces suppression patterns from feedback aggregation:
```sql
-- Aggregate thumbs-down by finding pattern
SELECT
  severity, category,
  -- FNV-1a fingerprint of normalized title (reuse existing fingerprintFindingTitle)
  title, COUNT(*) as thumbs_down_count
FROM feedback_reactions
WHERE repo = $repo
  AND reaction_content = '-1'
  AND created_at >= datetime('now', '-90 days')
GROUP BY severity, category, title
HAVING COUNT(*) >= $threshold
```

3. **Integration with existing suppression pipeline:** Feed feedback-derived suppressions into the existing `matchesSuppression()` check alongside config-defined suppressions. Mark these as `suppressionSource: "feedback"` to distinguish from manual config.

4. **Learning memory feedback loop:** When a thumbs-down is recorded, update the learning memory outcome to `"thumbs_down"`. When similar findings are retrieved during context-aware review, the `outcome: "thumbs_down"` signal tells the model this pattern was previously rejected by humans.

**Schema additions:**
```sql
-- Add to existing feedback_reactions table (or new derived table)
CREATE TABLE IF NOT EXISTS feedback_suppression_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  title_fingerprint TEXT NOT NULL,
  title_sample TEXT NOT NULL,
  thumbs_down_count INTEGER NOT NULL,
  thumbs_up_count INTEGER NOT NULL DEFAULT 0,
  net_sentiment INTEGER NOT NULL, -- thumbs_up - thumbs_down
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  auto_suppress INTEGER NOT NULL DEFAULT 0,
  UNIQUE(repo, severity, category, title_fingerprint)
);
```

**Config surface:**
- `review.feedback.autoSuppressThreshold: number` (default: 3) -- thumbs-down count to trigger auto-suppression
- `review.feedback.autoSuppressEnabled: boolean` (default: false) -- opt-in to start
- `review.feedback.autoSuppressWindow: number` (default: 90) -- days of feedback history to consider

**What NOT to build:**
- Do NOT add a reaction webhook handler. GitHub does not support reaction webhooks.
- Do NOT build real-time reaction processing. Polling on PR activity events is sufficient.
- Do NOT auto-suppress CRITICAL findings regardless of feedback count. Safety override.

**Confidence: HIGH** -- Extends existing `feedback-sync.ts` and `knowledge/store.ts` with zero new dependencies.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Auto-fixable detection | Prompt-driven classification | ESLint/Ruff programmatic API | Requires per-language toolchain installation in workspace; 10-30s overhead; brittle config parsing |
| File risk scoring | Git heuristics (lines + path signals + churn) | Cyclomatic complexity libraries | Language-specific tools, TypeScript-only, AST parsing overhead; lines changed is a better predictor for PR review |
| File risk scoring | Git heuristics | ML-based risk model | Massive overengineering; no training data; heuristics are sufficient and debuggable |
| Reaction capture | Polling on PR events (existing pattern) | Webhook-based reaction handler | GitHub does not emit reaction webhooks |
| Feedback auto-suppression | SQL aggregation + threshold | NLP-based sentiment analysis | Over-complex; thumbs-up/down is already structured sentiment data |
| Language rule storage | Static TypeScript registry | External database or config file | Rules change infrequently; static data is simpler, testable, and version-controlled |

## Installation

```bash
# No new dependencies required.
# The entire milestone is built on existing stack.
```

## Integration Points with Existing Stack

### Where Each Feature Connects

```
Feature 1: Language Rules
  Config:     src/execution/config.ts       -- add review.languageRules schema
  Rules:      src/execution/review-prompt.ts -- extend LANGUAGE_GUIDANCE with tiers
  Prompt:     src/execution/review-prompt.ts -- buildLanguageGuidanceSection() enhancement
  Scoring:    src/knowledge/confidence.ts    -- boost/penalty for language-specific findings

Feature 2: Large PR Intelligence
  Analysis:   src/execution/diff-analysis.ts -- add computeFileRiskScore(), prioritizeFiles()
  Prompt:     src/execution/review-prompt.ts -- buildDiffAnalysisSection() with priority annotations
  Handler:    src/handlers/review.ts         -- apply file budget before prompt construction
  Config:     src/execution/config.ts        -- add review.largePR schema

Feature 3: Feedback Auto-Suppression
  Sync:       src/handlers/feedback-sync.ts  -- already exists, extend with aggregation trigger
  Store:      src/knowledge/store.ts         -- add feedback_suppression_rules table + queries
  Types:      src/knowledge/types.ts         -- add FeedbackSuppressionRule type
  Confidence: src/knowledge/confidence.ts    -- integrate feedback suppressions into matchesSuppression()
  Learning:   src/learning/memory-store.ts   -- update outcome on thumbs-down
  Handler:    src/handlers/review.ts         -- load feedback suppressions alongside config suppressions
  Config:     src/execution/config.ts        -- add review.feedback schema
```

### Data Flow for Feedback Loop

```
1. Review publishes inline comment with finding
2. Human reacts with thumbs-down on comment
3. Next PR activity triggers feedback-sync handler (existing)
4. Sync polls reactions, stores in feedback_reactions table (existing)
5. Aggregation query computes thumbs-down count per pattern (NEW)
6. If count >= threshold, pattern added to feedback_suppression_rules (NEW)
7. Next review loads feedback suppressions alongside config suppressions (NEW)
8. Finding matching pattern is suppressed or downgraded (NEW)
9. Learning memory updated with thumbs_down outcome (NEW)
10. Future retrieval context shows pattern was rejected (existing retrieval)
```

## What NOT to Add (Avoiding Bloat)

| Do NOT Add | Rationale |
|------------|-----------|
| ESLint / Ruff / Clippy as runtime deps | Would require per-language toolchains in workspace; Kodiai reviews repos it does not own |
| AST parsing libraries (tree-sitter, babel, etc.) | Cyclomatic complexity is not needed; lines changed + path signals are better predictors |
| External vector DB (Pinecone, Qdrant) | sqlite-vec handles the scale; feedback patterns are per-repo, not cross-tenant |
| External message queue (Kafka, NATS) | Existing p-queue + SQLite job tracking is sufficient |
| NLP/sentiment analysis libs | Thumbs-up/down is already structured binary sentiment |
| New HTTP client libraries | Bun native fetch + existing Octokit handles everything |
| Database migration framework | Continue additive SQL in store.ts; existing pattern is proven |
| Additional embedding providers | Voyage AI is sufficient; single-provider simplicity |
| `linguist-languages` package | Existing `EXTENSION_LANGUAGE_MAP` covers 20 languages already |

## Version Compatibility

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| All new code | Bun 1.3.8+ | Runtime already installed; all features use Bun builtins |
| New SQLite tables | `bun:sqlite` WAL mode | Additive schema changes; no migration framework needed |
| Config extensions | `zod@4.3.6` | Same schema validation pattern as existing config |
| Reaction API calls | `@octokit/rest@22.0.1` | Methods already verified in `feedback-sync.ts` |
| Git commands | `git` CLI via `Bun.$` | Same pattern as existing `collectDiffContext()` |

## Sources

### Primary (HIGH confidence -- verified in codebase)
- `src/execution/diff-analysis.ts` -- `EXTENSION_LANGUAGE_MAP`, `PATH_RISK_SIGNALS`, `analyzeDiff()`, `parseNumstat()`
- `src/execution/review-prompt.ts` -- `LANGUAGE_GUIDANCE`, `buildLanguageGuidanceSection()`, `buildDiffAnalysisSection()`
- `src/handlers/feedback-sync.ts` -- reaction polling pipeline, `isHumanThumbReaction()`, idempotent storage
- `src/knowledge/store.ts` -- `feedback_reactions` table, `UNIQUE(repo, comment_id, reaction_id)`, `INSERT OR IGNORE`
- `src/knowledge/confidence.ts` -- `computeConfidence()`, `matchesSuppression()`, severity/category boosts
- `src/knowledge/types.ts` -- `FeedbackReaction`, `FindingRecord` with `commentId`/`commentSurface`
- `src/learning/types.ts` -- `MemoryOutcome` includes `"thumbs_down"`
- `src/execution/config.ts` -- Zod schema with section fallback parsing
- `src/handlers/review.ts` -- full review pipeline, finding extraction, suppression application

### Secondary (MEDIUM confidence -- verified via GitHub docs)
- [GitHub webhook events documentation](https://docs.github.com/en/webhooks/webhook-events-and-payloads) -- confirmed NO reaction webhook events exist (February 2026)
- [GitHub community discussion on reaction webhooks](https://github.com/orgs/community/discussions/7168) -- reactions do not trigger any webhook
- [GitHub community feature request for reaction webhooks](https://github.com/orgs/community/discussions/20824) -- open request, not implemented
- [Octokit reactions API](https://actions-cool.github.io/octokit-rest/api/reactions/) -- `listForPullRequestReviewComment` method verified
- [ESLint v10.0.0 Node.js API](https://eslint.org/docs/latest/integrate/nodejs-api) -- fixable detection API exists but requires linter runtime (rejected)

### Tertiary (LOW confidence -- general ecosystem knowledge)
- [Code quality metrics 2026](https://www.qodo.ai/blog/code-quality-metrics-2026/) -- hotspot risk = complexity * churn * ownership
- [Graphite large PR prioritization](https://graphite.dev/guides/prioritize-code-reviews-large-projects) -- file risk heuristics for code review
- [Code churn analysis](https://swimm.io/learn/developer-experience/how-to-measure-code-churn-why-it-matters-and-4-ways-to-reduce-it) -- churn as review priority signal

---
*Stack research for: Kodiai -- Language-Aware Enforcement, Large PR Intelligence, Feedback-Driven Learning*
*Researched: 2026-02-13*
