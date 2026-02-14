# Architecture Patterns

**Domain:** Language-Aware Enforcement, Large PR Intelligence, Feedback-Driven Learning
**Researched:** 2026-02-13
**Confidence:** HIGH

## Recommended Architecture

All three features integrate into the existing review pipeline as additional preprocessing steps and post-processing enhancements. No new services, no new processes, no new databases.

### System Integration Map

```
+------------------------------------------------------------------------------+
| Existing Review Pipeline (unchanged)                                         |
|                                                                              |
|  [Webhook] -> [Router] -> [Review Handler] -> [Executor] -> [Post-process]  |
|                                 |                                |           |
|                                 | (ENHANCED)                     |           |
|                                 v                                v           |
|  +--------------------------------------+  +--------------------------+      |
|  | Pre-Execution Context Assembly       |  | Post-Execution Processing|      |
|  |                                      |  |                          |      |
|  | 1. analyzeDiff()       [existing]    |  | 1. Extract findings      |      |
|  | 2. computeFileRiskScores()   [NEW]   |  | 2. Apply suppressions    |      |
|  | 3. prioritizeFiles()         [NEW]   |  | 3. Apply feedback supps  | [NEW]|
|  | 4. loadFeedbackSuppressions() [NEW]  |  | 4. Record findings       |      |
|  | 5. buildReviewPrompt()  [ENHANCED]   |  | 5. Learning memory write |      |
|  |    - Language severity tiers  [NEW]  |  | 6. Feedback aggregation  | [NEW]|
|  |    - Risk priority hints      [NEW]  |  |                          |      |
|  |    - Feedback suppression ctx [NEW]  |  |                          |      |
|  +--------------------------------------+  +--------------------------+      |
|                                                                              |
| Feedback Sync Pipeline (existing, enhanced)                                  |
|  [PR Activity Event] -> [Sync Reactions] -> [Store] -> [Aggregate]  [NEW]   |
+------------------------------------------------------------------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `diff-analysis.ts` (ENHANCED) | File risk scoring, per-file numstat, file prioritization | Review handler, prompt builder |
| `review-prompt.ts` (ENHANCED) | Language severity tiers in prompt, risk priority hints | Review handler (caller), Executor (consumer) |
| `confidence.ts` (ENHANCED) | Apply feedback-derived suppressions alongside config suppressions | Review handler (post-processing) |
| `knowledge/store.ts` (ENHANCED) | Feedback suppression rules table, aggregation queries | Review handler, feedback-sync handler |
| `feedback-sync.ts` (ENHANCED) | Trigger feedback aggregation after reaction sync | Knowledge store |
| `config.ts` (ENHANCED) | `review.languageRules`, `review.largePR`, `review.feedback` schemas | All components |

### New Modules (Pure Functions, No New Processes)

| Module | Location | Type | Purpose |
|--------|----------|------|---------|
| `computeFileRiskScore()` | `src/execution/diff-analysis.ts` | Pure function | Score individual files by risk heuristics |
| `prioritizeFiles()` | `src/execution/diff-analysis.ts` | Pure function | Sort files by risk, allocate comment budget |
| `parsePerFileNumstat()` | `src/execution/diff-analysis.ts` | Pure function | Per-file lines added/removed from numstat |
| `LANGUAGE_SEVERITY_RULES` | `src/execution/review-prompt.ts` | Static data | Auto-fixable vs safety-critical tiers per language |
| `buildLanguageSeveritySection()` | `src/execution/review-prompt.ts` | Pure function | Emit tiered language instructions to prompt |
| `loadFeedbackSuppressions()` | `src/knowledge/store.ts` | DB query | Load auto-suppression rules from feedback aggregation |
| `refreshFeedbackSuppressions()` | `src/knowledge/store.ts` | DB write | Recompute suppression rules from feedback_reactions |

### Data Flow

#### Feature 1: Language-Specific Severity Rules

```
.kodiai.yml config
    |
    v
loadRepoConfig() -- parse review.languageRules
    |
    v
analyzeDiff() -- classifies files by language (existing)
    |
    v
buildReviewPrompt()
    |
    v
buildLanguageSeveritySection() -- NEW: emit tiered instructions
    |  - Auto-fixable tier: "Do NOT flag these (linter handles them)"
    |  - Safety-critical tier: "Flag these at MAJOR or higher"
    v
Executor (Claude) applies language-specific severity rules in review
    |
    v
Post-processing: confidence scoring boosted for safety-critical categories
```

#### Feature 2: Risk-Weighted File Prioritization

```
git diff --numstat output (existing)
    |
    v
parsePerFileNumstat() -- NEW: per-file lines added/removed
    |
    v
computeFileRiskScore() -- NEW: composite score per file
    |  inputs: linesChanged, pathRiskSignals, categoryMultiplier, churnCount
    v
prioritizeFiles() -- NEW: sort by score, apply budget
    |
    v
buildReviewPrompt()
    |  - Inject file priority list into Change Context section
    |  - "Focus your review budget on these high-risk files"
    v
Executor (Claude) allocates attention to highest-risk files
```

#### Feature 3: Feedback-Driven Auto-Suppression

```
[Existing: feedback-sync polls reactions on PR events]
    |
    v
feedback_reactions table (existing, already populated)
    |
    v
refreshFeedbackSuppressions() -- NEW: aggregate thumbs-down by pattern
    |  GROUP BY severity, category, title_fingerprint
    |  HAVING COUNT(*) >= threshold (default: 3)
    v
feedback_suppression_rules table -- NEW
    |
    v
loadFeedbackSuppressions() -- NEW: read active rules for repo
    |
    v
Review handler: merge with config suppressions
    |
    v
matchesSuppression() -- existing, now checks both sources
    |
    v
Finding suppressed with suppressionSource: "feedback"
```

---

## Precise Codebase Integration Map

This section documents the exact insertion points, existing function signatures, and line-level integration details for each feature. Derived from reading every source file in the codebase.

### Existing Pipeline: review.ts Step-by-Step

The review handler (`handlers/review.ts`, 1898 lines) orchestrates the entire review. The following annotated pipeline shows exactly where each new feature inserts:

```
[Lines 817-865]   jobQueue.enqueue() + run-state idempotency check
[Lines 866-888]   workspace creation + git clone + fetch base ref
[Lines 890-896]   loadRepoConfig(.kodiai.yml)
[Lines 1019-1039] incrementalResult = computeIncrementalDiff()         -- fail-open
[Lines 1042-1080] collectDiffContext() + skipPaths filtering
[Lines 1082-1087] diffAnalysis = analyzeDiff({ changedFiles, numstatLines, diffContent })
                  ^^^ INSERT: file risk scoring + prioritization AFTER this line
[Lines 1089-1091] matchedPathInstructions
[Lines 1093-1111] priorFindingCtx from knowledgeStore                  -- fail-open
[Lines 1113-1146] retrievalCtx from isolationLayer + embeddingProvider -- fail-open
                  ^^^ INSERT: feedback suppression loading AFTER this block
[Lines 1148-1169] Profile presets merge (severity, maxComments, focusAreas)
[Lines 1192-1239] buildReviewPrompt({ ... all context ... })
                  ^^^ MODIFY: pass language rules, file priorities, feedback context
[Lines 1242-1267] executor.execute()
[Lines 1269-1281] extractFindingsFromReviewComments()
[Lines 1283-1335] processedFindings: suppression + confidence scoring
                  ^^^ INSERT: feedback-based suppression alongside config suppression
                  ^^^ INSERT: language severity overrides in confidence adjustment
[Lines 1367-1376] removeFilteredInlineComments()
[Lines 1389-1463] Review Details publication
[Lines 1520-1649] Knowledge store writes (review, findings, suppressions, global patterns)
[Lines 1664-1736] Learning memory writes (async fire-and-forget)
                  ^^^ INSERT: feedback bridge writes (also fire-and-forget)
```

### Feature 1: Language Severity -- Exact Integration Points

**Config Schema** (`execution/config.ts`)

The review schema is at lines 95-186. Add `languageRules` section:

```typescript
// Insert after line 153 (pathInstructions)
languageRules: z.record(
  z.string(), // language name matching EXTENSION_LANGUAGE_MAP values
  z.object({
    minSeverity: z.enum(["critical", "major", "medium", "minor"]).optional(),
    focus: z.array(z.enum(["security", "correctness", "performance", "style", "documentation"])).optional(),
    customGuidance: z.array(z.string()).optional(),
    autoFixable: z.array(z.string()).optional(), // patterns that linters handle
  })
).default({}),
```

**Prompt Builder** (`execution/review-prompt.ts`)

The existing `buildLanguageGuidanceSection()` is at lines 729-757. It takes `filesByLanguage: Record<string, string[]>` and merges entries with the static `LANGUAGE_GUIDANCE` map (lines 14-60).

Extend the function signature to accept language rules config:

```typescript
// Current signature (line 729):
export function buildLanguageGuidanceSection(
  filesByLanguage: Record<string, string[]>,
): string

// New signature:
export function buildLanguageGuidanceSection(
  filesByLanguage: Record<string, string[]>,
  languageRules?: Record<string, LanguageRuleConfig>,
): string
```

When `languageRules` is provided, merge `customGuidance` entries with `LANGUAGE_GUIDANCE`, add `minSeverity` floor instructions, and add `autoFixable` suppression instructions per language.

**Review Handler** (`handlers/review.ts`)

At the `buildReviewPrompt()` call (line 1192), pass the new config:

```typescript
// Current (line 1222):
filesByLanguage: diffAnalysis?.filesByLanguage,

// Also pass:
languageRules: config.review.languageRules,
```

For post-processing enforcement, after `processedFindings` computation (lines 1283-1335), apply language-based severity filter using `classifyFileLanguage()` (already exported from `diff-analysis.ts` at line 48):

```typescript
// Insert after line 1335
const languageFilteredFindings = processedFindings.filter(f => {
  const lang = classifyFileLanguage(f.filePath);
  const rules = config.review.languageRules[lang];
  if (!rules?.minSeverity) return true;
  return severityRank(f.severity) >= severityRank(rules.minSeverity);
});
```

### Feature 2: File Prioritization -- Exact Integration Points

**Config Schema** (`execution/config.ts`)

```typescript
// Insert in review schema (after line 155)
largePR: z.object({
  threshold: z.number().min(5).max(500).default(30),
  maxReviewFiles: z.number().min(5).max(200).default(50),
  alwaysInclude: z.array(z.string()).default([]),
}).default({ threshold: 30, maxReviewFiles: 50, alwaysInclude: [] }),
```

**Diff Analysis** (`execution/diff-analysis.ts`)

The existing `parseNumstat()` (line 180) aggregates totals. Add `parsePerFileNumstat()` that returns per-file stats:

```typescript
// Already has: function parseNumstat(numstatLines: string[]): { added: number; removed: number }
// Add: function parsePerFileNumstat(numstatLines: string[]): Map<string, { added: number; removed: number }>
```

The existing `PATH_RISK_SIGNALS` array (lines 120-167) defines risk patterns. `computeFileRiskScore()` checks each file against these patterns plus category and line count.

The existing `analyzeDiff()` (line 233) already returns `DiffAnalysis` with `filesByCategory`, `filesByLanguage`, `riskSignals`, `metrics`, `isLargePR`. The file prioritization uses this output, not modifying analyzeDiff itself.

**Review Handler** (`handlers/review.ts`)

Insert between `analyzeDiff()` (line 1082) and `buildReviewPrompt()` (line 1192):

```typescript
// After line 1087, before matchedPathInstructions
let prioritizationResult = null;
if (reviewFiles.length > config.review.largePR.threshold) {
  try {
    const perFileStats = parsePerFileNumstat(numstatLines);
    prioritizationResult = prioritizeFiles({
      files: reviewFiles,
      perFileStats,
      diffAnalysis,
      config: config.review.largePR,
      pathRiskSignals: PATH_RISK_SIGNALS, // re-exported from diff-analysis
    });
    reviewFiles = prioritizationResult.includedFiles;
    logger.info({
      ...baseLog,
      gate: "file-prioritization",
      included: prioritizationResult.includedFiles.length,
      excluded: prioritizationResult.excludedFiles.length,
      strategy: prioritizationResult.strategy,
    }, "File prioritization applied");
  } catch (err) {
    logger.warn({ ...baseLog, err }, "File prioritization failed (fail-open, using all files)");
  }
}
```

**Prompt Builder** (`execution/review-prompt.ts`)

Replace the current `isLargePR` handling (lines 505-507) with `buildLargePRPrioritizationSection()`:

```typescript
// Current (lines 505-507):
if (analysis.isLargePR) {
  lines.push("", "This is a large PR. Focus on the most critical changes.");
}

// Replace with:
if (prioritizationResult) {
  lines.push("", buildLargePRPrioritizationSection(prioritizationResult));
}
```

### Feature 3: Feedback Loop -- Exact Integration Points

**Critical Finding: GitHub Reaction Webhooks**

GitHub does NOT send webhook events for individual reactions on `pull_request_review_comment` objects. The existing `feedback-sync.ts` correctly uses REST API polling (`octokit.rest.reactions.listForPullRequestReviewComment`) triggered by PR activity events. This polling approach is architecturally correct and should be enhanced, not replaced.

**Knowledge Store** (`knowledge/store.ts`)

The `feedback_reactions` table (lines 218-237) already stores reactions with: repo, reviewId, findingId, commentId, reactionContent (+1/-1), severity, category, filePath, title.

Add a new table and two methods:

```sql
-- New table for materialized suppression rules
CREATE TABLE IF NOT EXISTS feedback_suppression_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  title_fingerprint TEXT NOT NULL,
  title_sample TEXT NOT NULL,
  thumbs_down_count INTEGER NOT NULL DEFAULT 0,
  thumbs_up_count INTEGER NOT NULL DEFAULT 0,
  net_sentiment INTEGER NOT NULL DEFAULT 0,
  auto_suppress INTEGER NOT NULL DEFAULT 0,
  last_refreshed TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo, severity, category, title_fingerprint)
);
```

New methods on `KnowledgeStore`:
- `refreshFeedbackSuppressions(repo: string, threshold: number, windowDays: number): number`
- `loadFeedbackSuppressions(repo: string): FeedbackSuppressionRule[]`

**Feedback Sync Handler** (`handlers/feedback-sync.ts`)

After `knowledgeStore.recordFeedbackReactions()` (line 183), trigger aggregation:

```typescript
// After line 183
try {
  knowledgeStore.refreshFeedbackSuppressions(repo,
    config?.review?.feedback?.suppressionThreshold ?? 3,
    config?.review?.feedback?.windowDays ?? 90
  );
} catch (err) {
  logger.warn({ err, repo }, "Feedback suppression refresh failed (fail-open)");
}
```

Note: `createFeedbackSyncHandler` currently does not load repo config. It would need either (a) config passed as parameter, or (b) default threshold hardcoded. Option (b) is simpler and consistent with fail-open design.

**Review Handler** (`handlers/review.ts`)

Load feedback suppressions alongside config suppressions (insert after retrieval context block, around line 1146):

```typescript
let feedbackSuppressions: FeedbackSuppressionRule[] = [];
if (knowledgeStore && config.review.feedback?.autoSuppressEnabled) {
  try {
    feedbackSuppressions = knowledgeStore.loadFeedbackSuppressions(
      `${apiOwner}/${apiRepo}`
    );
  } catch (err) {
    logger.warn({ ...baseLog, err }, "Feedback suppression load failed (fail-open)");
  }
}
```

In the post-processing loop (lines 1284-1325), merge feedback suppressions with config suppressions:

```typescript
// Existing (line 1285):
const matchedSuppression = config.review.suppressions.find(...)

// Enhanced: also check feedback suppressions
const matchedFeedbackSuppression = feedbackSuppressions.find(rule =>
  rule.autoSuppress &&
  rule.severity === finding.severity &&
  rule.category === finding.category &&
  rule.titleFingerprint === fingerprintFindingTitle(finding.title)
);
```

**Learning Memory Integration** (optional enhancement)

The existing `learning/types.ts` `MemoryOutcome` (line 3) already includes `"thumbs_up" | "thumbs_down"` but these are never written. To close the learning loop into retrieval context:

After feedback reactions are recorded, fire-and-forget write to learning memory (similar to the existing async write pattern at review.ts lines 1664-1736). This requires passing `learningMemoryStore` and `embeddingProvider` to `createFeedbackSyncHandler()` -- update the deps in `index.ts` (line 146-152).

**Confidence Scoring** (`knowledge/confidence.ts`)

The existing `computeConfidence()` (line 39) uses a fixed formula: `50 + SEVERITY_BOOST + CATEGORY_BOOST + patternBoost`. Extend to accept optional feedback signal:

```typescript
// Current (line 4):
export type ConfidenceInput = {
  severity: FindingSeverity;
  category: FindingCategory;
  matchesKnownPattern: boolean;
};

// Enhanced:
export type ConfidenceInput = {
  severity: FindingSeverity;
  category: FindingCategory;
  matchesKnownPattern: boolean;
  feedbackSignal?: {
    thumbsUp: number;
    thumbsDown: number;
  };
};
```

Adjustment: net negative feedback (thumbsDown > thumbsUp * 2) applies -15 penalty. Strong negative (thumbsDown >= 3, thumbsUp === 0) applies -25. Net positive applies +5.

---

## Patterns to Follow

### Pattern 1: Static Rule Registry (Language Severity Tiers)

**What:** Define language rules as a typed constant object, not a dynamic config or database.
**When:** Rules change infrequently (language safety semantics are stable) and need to be version-controlled.
**Example:**
```typescript
type LanguageSeverityTier = "auto-fixable" | "safety-critical";

type LanguageSeverityRule = {
  pattern: string;        // Human-readable description
  tier: LanguageSeverityTier;
  severityFloor?: FindingSeverity;  // Minimum severity for safety-critical
};

const LANGUAGE_SEVERITY_RULES: Record<string, LanguageSeverityRule[]> = {
  Go: [
    { pattern: "Unchecked error returns", tier: "safety-critical", severityFloor: "major" },
    { pattern: "Goroutine leak risk", tier: "safety-critical", severityFloor: "major" },
    { pattern: "Unused import", tier: "auto-fixable" },
  ],
  Python: [
    { pattern: "Mutable default arguments", tier: "safety-critical", severityFloor: "major" },
    { pattern: "Bare except clause", tier: "safety-critical", severityFloor: "major" },
    { pattern: "Unused import", tier: "auto-fixable" },
    { pattern: "Import ordering", tier: "auto-fixable" },
  ],
  // ... per language
};
```

### Pattern 2: Composite Risk Score (File Prioritization)

**What:** Weighted sum of observable signals, each normalized to 0-1 range.
**When:** Need to rank items (files) for attention allocation without ML models.
**Example:**
```typescript
type FileRiskInput = {
  linesChanged: number;
  maxLinesInPR: number;
  pathRiskSignalCount: number;
  category: "source" | "test" | "config" | "docs" | "infra";
  recentChurnCount: number;
};

const CATEGORY_RISK_MULTIPLIER: Record<string, number> = {
  source: 1.0,
  infra: 0.8,
  config: 0.3,
  test: 0.2,
  docs: 0.1,
};

function computeFileRiskScore(input: FileRiskInput): number {
  const normalizedLines = input.maxLinesInPR > 0
    ? Math.min(1, input.linesChanged / input.maxLinesInPR)
    : 0;
  const normalizedChurn = Math.min(1, input.recentChurnCount / 50);
  const categoryWeight = CATEGORY_RISK_MULTIPLIER[input.category] ?? 0.5;

  return (
    0.35 * normalizedLines +
    0.30 * Math.min(1, input.pathRiskSignalCount / 3) +
    0.20 * categoryWeight +
    0.15 * normalizedChurn
  );
}
```

### Pattern 3: Threshold-Based Suppression Generation

**What:** Convert aggregated feedback signals into actionable suppression rules with a configurable threshold.
**When:** Need to "learn" from user behavior without ML models.
**Example:**
```typescript
type FeedbackSuppressionRule = {
  repo: string;
  severity: FindingSeverity;
  category: FindingCategory;
  titleFingerprint: string;
  titleSample: string;
  thumbsDownCount: number;
  thumbsUpCount: number;
  netSentiment: number;  // thumbsUp - thumbsDown
  autoSuppress: boolean;
};

// Query to generate rules
const AGGREGATE_FEEDBACK_SQL = `
  SELECT
    severity, category, title,
    SUM(CASE WHEN reaction_content = '-1' THEN 1 ELSE 0 END) AS thumbs_down,
    SUM(CASE WHEN reaction_content = '+1' THEN 1 ELSE 0 END) AS thumbs_up
  FROM feedback_reactions
  WHERE repo = $repo
    AND created_at >= datetime('now', $windowModifier)
  GROUP BY severity, category, title
  HAVING SUM(CASE WHEN reaction_content = '-1' THEN 1 ELSE 0 END) >= $threshold
`;
```

### Pattern 4: Fail-Open Enrichment (Existing, Must Follow)

Every optional enrichment step MUST wrap in try/catch and log warnings on failure. The review continues with degraded functionality. All three new features are optional enrichments.

```typescript
// Established pattern from review.ts (lines 1113-1146):
let retrievalCtx = null;
if (isolationLayer && embeddingProvider && config.knowledge.retrieval.enabled) {
  try {
    // ... enrichment logic
  } catch (err) {
    logger.warn({ ...baseLog, err }, "...failed (fail-open, proceeding without...)");
  }
}
```

### Pattern 5: Section Builder Composition (Existing, Must Follow)

Every prompt concern is a standalone function returning a string section. New features add new builders that follow the same shape:

```typescript
// Existing (review-prompt.ts):
export function buildLanguageGuidanceSection(...): string
export function buildDiffAnalysisSection(...): string
export function buildRetrievalContextSection(...): string

// New:
export function buildLanguageSeveritySection(...): string
export function buildLargePRPrioritizationSection(...): string
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Running Linters in the Review Workspace

**What:** Shelling out to ESLint, Ruff, Clippy, etc. during review execution.
**Why bad:** Workspace is a shallow git clone. No `node_modules`, no Python venv, no Cargo cache. Installing toolchains adds 10-30s and may fail. Linter configs vary wildly across repos.
**Instead:** Use prompt instructions. Claude knows what is auto-fixable by training. The `LANGUAGE_SEVERITY_RULES` registry tells the model what to suppress vs enforce.

### Anti-Pattern 2: ML-Based Risk Scoring

**What:** Training a model to predict file risk from features.
**Why bad:** No training data exists. The model would overfit to the small number of repos currently using Kodiai. Heuristics are transparent and debuggable.
**Instead:** Use a weighted formula with configurable weights. Users can understand and override the scoring.

### Anti-Pattern 3: Automatic Behavior Mutation from Implicit Feedback

**What:** Automatically changing review severity or suppression based on reaction signals without user awareness.
**Why bad:** Users cannot explain why findings disappeared. Debugging "the bot stopped catching X" is impossible without audit trail.
**Instead:** Make auto-suppression opt-in (`review.feedback.autoSuppressEnabled: false` by default). Show suppression source ("Suppressed by feedback: 4 thumbs-down in last 90 days"). Never suppress CRITICAL.

### Anti-Pattern 4: Equal File Treatment in Large PRs

**What:** Giving all 300 files in a large PR the same review attention.
**Why bad:** Research shows reviewers spot defects best at 200-400 lines. After that, attention drops. Spreading 7 comments across 300 files means nothing meaningful lands.
**Instead:** Score files by risk, allocate comment budget to top-scoring files, and explicitly tell the model to skip low-risk files.

### Anti-Pattern 5: File Prioritization Before Diff Analysis

**What:** Filtering files before running `analyzeDiff()`.
**Why bad:** `analyzeDiff()` needs ALL files to produce accurate categories, risk signals, and language detection. Filtering beforehand produces incomplete analysis.
**Instead:** Run `analyzeDiff()` on all files first (it already caps at 200), then use analysis results to inform prioritization.

### Anti-Pattern 6: Event-Driven Reaction Capture

**What:** Registering a webhook handler for reaction events on review comments.
**Why bad:** GitHub does NOT send webhook events for reactions on `pull_request_review_comment` objects. The `.created` event fires for new comments, not reactions. This would create dead code.
**Instead:** Enhance the existing REST API polling in `feedback-sync.ts`.

---

## Scalability Considerations

| Concern | At 10 repos | At 100 repos | At 1000 repos |
|---------|-------------|--------------|---------------|
| Feedback aggregation | Inline SQL query per review | Same -- SQLite handles this easily | Add index on `(repo, reaction_content, created_at)` if slow |
| Risk scoring | Instant (10-50 files) | Instant (50-200 files) | Git churn queries may need caching for >500 file PRs |
| Language rules | Static lookup, O(1) | Same | Same |
| Feedback suppression rules | In-memory per review | Same | Consider caching per-repo suppression rules (invalidate on new reactions) |
| Config schema parsing | Per-review, negligible | Same | Same |

---

## Suggested Phase Ordering

### Phase 1: Language-Aware Severity Enforcement (no dependencies)

**Rationale:** Extends existing `LANGUAGE_GUIDANCE` and `filesByLanguage` directly. Config addition is isolated. Both prompt and post-processing are small and independently testable. Immediate noise reduction value for polyglot repos.

**Build order within phase:**
1. Config schema (`languageRules` Zod section)
2. `LANGUAGE_SEVERITY_RULES` static registry
3. Prompt builder extension (merge config + built-in guidance)
4. Post-processing filter (language severity floor)
5. Tests

### Phase 2: Large PR File Prioritization (independent of Phase 1, benefits from it)

**Rationale:** Uses diff analysis output (already exists). Can benefit from language awareness for scoring. Independent of feedback. Addresses concrete pain point for monorepo PRs.

**Build order within phase:**
1. Config schema (`largePR` Zod section)
2. `parsePerFileNumstat()` function
3. `computeFileRiskScore()` function
4. `prioritizeFiles()` orchestrator
5. Prompt section (`buildLargePRPrioritizationSection`)
6. Handler integration (between analyzeDiff and buildReviewPrompt)
7. Tests

### Phase 3: Feedback-Driven Learning Loop (depends on feedback reactions being populated)

**Rationale:** Depends on existing feedback infrastructure having captured data. Most complex -- involves new table, aggregation queries, suppression merging, and optionally confidence formula changes. Benefits from Phases 1-2 providing more data.

**Build order within phase:**
1. Knowledge store schema (`feedback_suppression_rules` table)
2. `refreshFeedbackSuppressions()` aggregation method
3. `loadFeedbackSuppressions()` query method
4. Config schema (`review.feedback` section, autoSuppressEnabled defaulting to false)
5. Handler integration (load + merge feedback suppressions)
6. Feedback-sync handler integration (trigger aggregation after reaction capture)
7. Optional: confidence formula extension with feedback signal
8. Optional: learning memory bridge for thumbs_up/thumbs_down outcomes
9. Tests

---

## Sources

- Direct codebase analysis of all source files (HIGH confidence):
  - `src/handlers/review.ts` (1898 lines -- full pipeline with line-level annotations)
  - `src/handlers/feedback-sync.ts` (204 lines -- reaction polling mechanism)
  - `src/execution/review-prompt.ts` (1211 lines -- all section builders)
  - `src/execution/diff-analysis.ts` (339 lines -- file classification and risk signals)
  - `src/execution/config.ts` (481 lines -- Zod config schema)
  - `src/execution/executor.ts` (254 lines -- Claude SDK wrapper)
  - `src/knowledge/store.ts` (777 lines -- SQLite schema and queries)
  - `src/knowledge/confidence.ts` (97 lines -- scoring formula)
  - `src/knowledge/types.ts` (164 lines -- type definitions)
  - `src/learning/memory-store.ts` (348 lines -- vector search)
  - `src/learning/types.ts` (83 lines -- MemoryOutcome includes unused thumbs types)
  - `src/learning/isolation.ts` (127 lines -- retrieval with provenance)
  - `src/webhook/router.ts` (138 lines -- event dispatch)
  - `src/webhook/types.ts` (26 lines -- event/handler types)
  - `src/index.ts` (171 lines -- service wiring and dependency injection)
- GitHub Webhooks API: reaction events are NOT available for individual review comments (HIGH confidence from API documentation)

---
*Architecture research for: Kodiai -- Language-Aware Enforcement, Large PR Intelligence, Feedback-Driven Learning*
*Researched: 2026-02-13*
