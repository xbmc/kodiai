# Architecture: Intelligent Review System Integration

**Domain:** AI-powered code review with pattern analysis, learning, severity classification, and configurable review modes
**Researched:** 2026-02-11
**Confidence:** HIGH -- based on full codebase analysis of existing architecture plus ecosystem research

## Existing Architecture (As-Is)

The system follows a clean pipeline with clear boundaries:

```
GitHub Webhook
    |
    v
[Hono HTTP] --> [Signature Verify] --> [Dedup] --> [Event Router]
                                                        |
                                    +-------------------+-------------------+
                                    |                                       |
                              [Review Handler]                      [Mention Handler]
                                    |                                       |
                              [Job Queue]                             [Job Queue]
                           (per-installation)                      (per-installation)
                                    |                                       |
                              [Workspace Manager]                   [Workspace Manager]
                              (shallow clone)                       (shallow clone)
                                    |                                       |
                              [loadRepoConfig]                      [loadRepoConfig]
                              (.kodiai.yml)                          (.kodiai.yml)
                                    |                                       |
                              [buildReviewPrompt]                   [buildPrompt/mention]
                                    |                                       |
                              [Executor]                              [Executor]
                              (Agent SDK query())                   (Agent SDK query())
                                    |                                       |
                              [MCP Servers]                         [MCP Servers]
                              (publish to GitHub)                   (publish to GitHub)
```

### Key Architectural Properties to Preserve

1. **Stateless job execution:** Each job is self-contained -- clone, config, prompt, execute, publish, cleanup. No shared mutable state between jobs.

2. **Prompt-driven behavior:** All review intelligence lives in the prompt text passed to `query()`. The executor is a thin wrapper that manages timeout/MCP/tools. Changing review behavior means changing the prompt.

3. **Config-gated execution:** The review handler loads config twice (handler for gate checks, executor for model/timeout). Config controls whether and how reviews run.

4. **MCP-based output:** All GitHub output goes through MCP tool calls (comment server, inline review server). The executor tracks `published` state via an `onPublish` callback.

5. **Fire-and-forget telemetry:** After execution, handlers write telemetry records to SQLite. Non-blocking, never fails the job.

6. **Strict output format validation:** The comment server validates review summary format (severity headings, issue line format). This is existing structured output enforcement.

---

## Integration Architecture (To-Be)

### Design Principle: Enrich the prompt, don't restructure the pipeline

The existing architecture is clean and well-factored. Intelligent review features integrate by:

1. **Enriching the prompt** with pattern context, severity instructions, and repo-specific learnings
2. **Adding a knowledge store** alongside the existing telemetry store (same SQLite pattern)
3. **Extending config** with review mode and severity settings (same zod schema pattern)
4. **Post-processing feedback** captured from GitHub reactions/comments into the knowledge store

The pipeline shape stays the same. New components add data inputs to `buildReviewPrompt()` and a feedback capture path after execution.

### To-Be Pipeline

```
GitHub Webhook
    |
    v
[Hono HTTP] --> [Signature Verify] --> [Dedup] --> [Event Router]
                                                        |
                                    +-------------------+-------------------+
                                    |                                       |
                              [Review Handler]                      [Mention Handler]
                                    |                                       |
                              [Job Queue]                             (unchanged)
                           (per-installation)
                                    |
                              [Workspace Manager]
                              (shallow clone)
                                    |
                      +-----------+-----------+
                      |                       |
                [loadRepoConfig]        [Knowledge Store]        <-- NEW: read learnings
                (.kodiai.yml)           (SQLite, per-repo)
                      |                       |
                      +-----------+-----------+
                                  |
                          [buildReviewPrompt]                    <-- MODIFIED: enriched
                          (+ severity config)
                          (+ review mode)
                          (+ repo patterns/learnings)
                          (+ diff analysis context)
                                  |
                            [Executor]
                            (Agent SDK query())
                                  |
                            [MCP Servers]
                            (publish to GitHub)
                                  |
                      +-----------+-----------+
                      |                       |
                [Telemetry Store]       [Knowledge Store]        <-- NEW: write feedback
                (fire-and-forget)       (fire-and-forget)
```

---

## Component Map: New vs Modified

### New Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Knowledge Store | `src/knowledge/store.ts` | SQLite-backed per-repo pattern/learnings storage |
| Knowledge Types | `src/knowledge/types.ts` | Type definitions for learnings, patterns, feedback |
| Diff Analyzer | `src/execution/diff-analysis.ts` | Pre-execution diff classification (file types, change scope, risk signals) |
| Severity Config Schema | (within `src/execution/config.ts`) | New zod schema section for severity/mode settings |
| Review Mode Logic | (within `src/execution/review-prompt.ts`) | Mode-specific prompt sections |
| Feedback Capture | `src/knowledge/feedback.ts` | Parse GitHub reactions/resolution into learnings |

### Modified Components

| Component | Location | Change |
|-----------|----------|--------|
| `buildReviewPrompt()` | `src/execution/review-prompt.ts` | Accept severity config, review mode, learnings, diff analysis context |
| `loadRepoConfig()` | `src/execution/config.ts` | New `review.mode`, `review.severity`, `review.patterns` config sections |
| Review Handler | `src/handlers/review.ts` | Load learnings from knowledge store, run diff analysis, pass to prompt builder |
| Comment Server | `src/execution/mcp/comment-server.ts` | Validate severity headings match configured levels |
| App Entrypoint | `src/index.ts` | Initialize knowledge store, pass to review handler |

### Unchanged Components

| Component | Why Unchanged |
|-----------|---------------|
| Executor | Remains a thin wrapper around `query()`. Intelligence is in the prompt, not the executor. |
| Job Queue | No structural changes. Per-installation concurrency still works. |
| Workspace Manager | Ephemeral clones unchanged. Knowledge store is separate from workspace. |
| Mention Handler | v0.4 focuses on review intelligence. Mention handling stays as-is. |
| Inline Review Server | Already supports line-level comments. No changes needed. |
| Telemetry Store | Existing telemetry is orthogonal to knowledge. Stays as-is. |
| Event Router | Same events, same dispatch. No new webhook types needed. |

---

## Integration Point 1: Review Mode Configuration

### Where It Fits

New fields in the `review` section of `.kodiai.yml`, parsed by the existing zod schema in `src/execution/config.ts`.

### Config Schema Extension

```yaml
# .kodiai.yml
review:
  enabled: true
  mode: "balanced"        # NEW: "strict" | "balanced" | "lenient"
  severity:               # NEW: severity classification settings
    levels:               # Which severity levels to report
      - "critical"
      - "major"
      - "minor"
    minLevel: "minor"     # Minimum severity to report (filters out below this)
  patterns:               # NEW: repo-specific review patterns
    focus:                # Areas to emphasize
      - "security"
      - "error-handling"
    ignore:               # Areas to de-emphasize
      - "style"
      - "naming"
    customRules: []       # Free-text rules for this repo
  # ... existing fields unchanged
```

### How Mode Affects Behavior

Review mode maps to prompt instructions, not execution parameters. The executor, model, timeout, and tools stay identical. Only the prompt text changes.

| Mode | Behavior | Prompt Effect |
|------|----------|---------------|
| `strict` | Report all findings including minor issues. More verbose. Higher false positive rate. | Adds instructions to flag style issues, naming concerns, documentation gaps |
| `balanced` (default) | Focus on bugs, security, and correctness. Skip style nits. | Current behavior (existing prompt is already balanced) |
| `lenient` | Only critical and major issues. Maximum noise reduction. | Adds explicit "ONLY report issues that would cause bugs, crashes, or security vulnerabilities" |

### Implementation Strategy

The review mode translates to a prompt section inserted into `buildReviewPrompt()`. This is a string concatenation -- no new control flow needed.

```typescript
function buildModeInstructions(mode: ReviewMode): string {
  switch (mode) {
    case "strict":
      return STRICT_MODE_INSTRUCTIONS;
    case "lenient":
      return LENIENT_MODE_INSTRUCTIONS;
    case "balanced":
    default:
      return ""; // Current behavior is balanced
  }
}
```

---

## Integration Point 2: Severity Classification

### Where It Lives

Severity classification is enforced at two points:

1. **In the prompt** -- instructions tell Claude which severity levels to use and how to classify
2. **In the comment server** -- the existing `sanitizeKodiaiReviewSummary()` in `comment-server.ts` already validates severity headings

### Current State

The existing prompt already uses severity headings:
```
MUST group issues under severity headings: Critical, Must Fix, Major, Medium, Minor
```

The existing comment server validates:
```typescript
const severityHeadings = new Set(["Critical", "Must Fix", "Major", "Medium", "Minor"]);
```

### What Changes

1. **Severity filtering:** When `review.severity.minLevel` is set to "major", the prompt tells Claude to skip minor issues entirely. This is a prompt-level filter, not post-processing.

2. **Configurable severity set:** The prompt adapts to the configured severity levels rather than always listing all five.

3. **No post-processing filter needed:** It would be tempting to filter Claude's output after execution, but this is wrong for two reasons:
   - Claude should spend tokens on high-value analysis, not generate findings that get discarded
   - The prompt-based approach is simpler and more predictable

### Severity Mapping

```
Severity Level    When Used                              Prompt Guidance
─────────────────────────────────────────────────────────────────────────
Critical          Crashes, data loss, security holes      "Will cause production incidents"
Must Fix          Incorrect behavior, auth bypass         "Bug that manifests under normal conditions"
Major             Performance, resource leaks, races      "Degrades quality under load or over time"
Medium            Error handling gaps, edge cases          "Could cause problems in edge cases"
Minor             Style, naming, minor cleanup             "Nice to fix but not urgent"
```

---

## Integration Point 3: Knowledge Store (Learning System)

### Architecture Decision: SQLite alongside telemetry

The knowledge store follows the same pattern as the existing telemetry store:
- SQLite with WAL mode
- Factory function (`createKnowledgeStore()`)
- Fire-and-forget writes from handlers
- Separate database file (`./data/kodiai-knowledge.db`)

Using a separate database file (not the telemetry DB) because:
- Different retention policies (learnings are long-lived, telemetry is 90-day)
- Different access patterns (learnings are read per-review, telemetry is read by CLI)
- Keeps concerns separated (can back up/migrate independently)

### Data Model

```sql
-- Repo-specific review learnings
CREATE TABLE learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,              -- "owner/repo"
  category TEXT NOT NULL,          -- "pattern" | "preference" | "context"
  content TEXT NOT NULL,           -- The learning itself (free text)
  source TEXT NOT NULL,            -- "config" | "feedback" | "analysis"
  confidence REAL NOT NULL DEFAULT 0.5,  -- 0.0 to 1.0
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);

CREATE INDEX idx_learnings_repo ON learnings(repo);
CREATE INDEX idx_learnings_repo_category ON learnings(repo, category);
```

### Three Sources of Learnings

1. **Config-defined patterns** (`source: "config"`)
   - From `.kodiai.yml` `review.patterns.customRules`
   - Loaded at config parse time, stored on first encounter
   - HIGH confidence (explicitly configured by repo owner)

2. **Feedback-derived learnings** (`source: "feedback"`)
   - When a developer resolves a review comment (marks as resolved vs. replies with disagreement)
   - When thumbs-down reactions appear on Kodiai comments
   - MEDIUM confidence initially, increases with repetition

3. **Analysis-derived context** (`source: "analysis"`)
   - Patterns detected from the codebase itself (e.g., "this repo uses Result<T> pattern for error handling")
   - Generated during diff analysis phase
   - LOW confidence initially, increases if validated by feedback

### How Learnings Flow Into Reviews

During `buildReviewPrompt()`, the handler queries the knowledge store for the current repo and injects relevant learnings as a prompt section:

```
## Repo-Specific Context

The following patterns and preferences have been learned for this repository:

Patterns:
- This repo uses the Result<T, E> pattern for error handling (confidence: high)
- Database queries use prepared statements with Bun SQLite (confidence: high)

Preferences:
- The team prefers explicit error messages over generic throws (confidence: medium)
- Style nits on import ordering are unwanted (confidence: medium)
```

### Prompt Token Budget

Learnings must be bounded. With unlimited learnings, the prompt becomes too long and dilutes the review focus.

**Budget:** Maximum 20 learnings per review, prioritized by:
1. Confidence (high first)
2. Recency (recently used first)
3. Usage count (frequently used first)

**Character limit:** 2000 characters total for the learnings section. This keeps the prompt impact small relative to the diff context.

---

## Integration Point 4: Diff Analysis (Pre-Execution)

### What It Does

Before building the prompt, analyze the diff to provide structured context that helps Claude focus its review. This is NOT a separate AI call -- it is deterministic analysis of the git diff output.

### Where It Fits

New step in the review handler, after workspace creation and config loading, before prompt building:

```typescript
// In review handler, after config loads:
const diffAnalysis = analyzeDiff({
  workspaceDir: workspace.dir,
  baseBranch: pr.base.ref,
  changedFiles,
});

const reviewPrompt = buildReviewPrompt({
  // ... existing params
  diffAnalysis,     // NEW
  learnings,        // NEW
  reviewMode: config.review.mode,      // NEW
  severityConfig: config.review.severity,  // NEW
});
```

### What Diff Analysis Produces

```typescript
interface DiffAnalysis {
  // File classification
  filesByCategory: {
    source: string[];      // .ts, .js, .py, etc.
    test: string[];        // **/*.test.*, **/*.spec.*
    config: string[];      // .yml, .json, tsconfig, etc.
    docs: string[];        // .md, .txt, LICENSE, etc.
    infra: string[];       // Dockerfile, .github/*, terraform, etc.
  };

  // Scale indicators
  totalLinesChanged: number;
  totalFilesChanged: number;
  isLargeDiff: boolean;        // >500 lines or >20 files

  // Risk signals (deterministic, not AI)
  riskSignals: string[];
  // Examples:
  // "Modifies authentication-related files"
  // "Changes database schema or migration files"
  // "Adds new dependencies"
  // "Modifies CI/CD configuration"
  // "Touches security-sensitive paths (auth, crypto, secrets)"
}
```

### Why Deterministic, Not AI

Using an AI call for diff analysis would:
- Add latency and cost before the main review even starts
- Create a dependency on a second LLM invocation
- Be unreliable (the main review already reads the diff)

Deterministic analysis is fast, free, and predictable. It gives Claude structured context about what kind of change this is, which helps it prioritize its review focus.

### Risk Signal Detection

Risk signals are keyword/path-based heuristics:

```typescript
const RISK_PATTERNS = [
  { pattern: /auth|login|session|token|jwt|oauth/i, signal: "Modifies authentication-related code" },
  { pattern: /password|secret|credential|api.?key/i, signal: "Touches credential-handling code" },
  { pattern: /migration|schema|alter.table/i, signal: "Changes database schema" },
  { pattern: /\.env|secret|credential/i, signal: "Modifies secret/credential files" },
  { pattern: /package\.json|Cargo\.toml|go\.mod|requirements\.txt/i, signal: "Adds or changes dependencies" },
  { pattern: /Dockerfile|\.github\/|terraform|pulumi/i, signal: "Modifies infrastructure/CI configuration" },
  { pattern: /crypto|encrypt|decrypt|hash|sign|verify/i, signal: "Touches cryptographic code" },
];
```

---

## Integration Point 5: Feedback Capture

### How Feedback Gets Into the System

Feedback capture uses existing webhook events that Kodiai already receives but does not currently act on:

| Feedback Signal | GitHub Event | What It Means |
|----------------|--------------|---------------|
| Comment resolved | `pull_request_review_comment` with state change | Developer agreed, fixed the issue |
| Thumbs-down reaction | `issue_comment` reaction event | Developer disagreed with finding |
| Reply disagreeing | `issue_comment.created` replying to Kodiai | Developer explains why finding is wrong |
| No action taken | (absence of resolution) | Finding was ignored (possible false positive) |

### Implementation Approach: Start Simple

Phase 1 (v0.4): Only capture explicit config-defined patterns and write them to the knowledge store. This requires zero new webhook handling.

Phase 2 (future): Add feedback capture from GitHub events. This requires new event router registrations and more complex state tracking.

**Rationale:** The learning system's value comes primarily from:
1. Config-defined custom rules (immediate, high confidence)
2. Repo-context analysis (automatic, medium confidence)
3. Feedback loops (delayed, requires tracking state across reviews)

Items 1 and 2 deliver most of the value and are simpler to build. Item 3 is a future enhancement.

### Knowledge Store in Prompt Flow

```
                    ┌─────────────────────┐
                    │   .kodiai.yml        │
                    │  review.patterns:    │
                    │    customRules:      │
                    │      - "..."         │
                    └─────────┬───────────┘
                              │ (config load)
                              v
┌──────────────┐    ┌─────────────────────┐    ┌──────────────┐
│ Knowledge DB │<───│   Review Handler    │───>│ Diff Analyzer│
│ (SQLite)     │    │                     │    │ (deterministic)
│              │    │  1. Load config     │    └──────┬───────┘
│  learnings   │    │  2. Load learnings  │           │
│  table       │    │  3. Analyze diff    │           │
│              │    │  4. Build prompt    │<──────────┘
└──────────────┘    │  5. Execute         │
                    │  6. Store feedback  │
                    └─────────────────────┘
```

---

## Data Flow: Complete Review Job (v0.4)

```
1. Webhook arrives (pull_request.opened)
   |
2. Event router dispatches to Review Handler
   |
3. Handler enqueues job (per-installation queue)
   |
4. Job starts:
   |
   ├── 4a. Create workspace (shallow clone, depth 50)
   ├── 4b. Fetch base branch for diff
   |
5. Load config (.kodiai.yml)
   |  - review.mode: "balanced"
   |  - review.severity.minLevel: "medium"
   |  - review.patterns.customRules: [...]
   |  - review.patterns.focus: ["security"]
   |
6. Load learnings from Knowledge Store            <-- NEW
   |  - Query: SELECT * FROM learnings WHERE repo = ?
   |    ORDER BY confidence DESC, usage_count DESC LIMIT 20
   |
7. Run diff analysis                              <-- NEW
   |  - Classify changed files by category
   |  - Detect risk signals
   |  - Compute scale indicators
   |
8. Build enriched review prompt                   <-- MODIFIED
   |  - Context header (existing)
   |  - Scale notes (existing)
   |  - Review mode instructions (NEW)
   |  - Severity classification guidance (NEW)
   |  - Repo-specific learnings section (NEW)
   |  - Risk signal summary (NEW)
   |  - Diff reading instructions (existing)
   |  - What to look for (existing, filtered by mode)
   |  - How to report (existing)
   |  - Rules (existing)
   |  - Custom instructions (existing)
   |
9. Execute via Agent SDK query()                  (unchanged)
   |
10. Stream messages, collect result               (unchanged)
   |
11. Post-execution:
    |
    ├── 11a. Telemetry store write                (unchanged)
    ├── 11b. Update learning usage counts         <-- NEW
    ├── 11c. Auto-approval logic                  (unchanged)
    └── 11d. Error handling / error comments      (unchanged)
   |
12. Workspace cleanup                             (unchanged)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Review Handler | Orchestrates the review job lifecycle | Job Queue, Workspace Manager, Config, Knowledge Store, Diff Analyzer, Prompt Builder, Executor |
| Config (enhanced) | Parses review mode, severity, patterns from `.kodiai.yml` | Review Handler (provides config) |
| Knowledge Store | Persists and retrieves per-repo learnings | Review Handler (read on review, write on feedback) |
| Diff Analyzer | Deterministic pre-analysis of the git diff | Review Handler (called before prompt build) |
| Prompt Builder (enhanced) | Assembles enriched prompt with all context | Review Handler (called with enriched inputs) |
| Executor | Thin wrapper around Agent SDK `query()` | Review Handler (receives prompt, returns result) |
| Comment Server (enhanced) | Validates output format including severity | Executor/MCP (validates during publication) |

---

## Patterns to Follow

### Pattern 1: Prompt Enrichment Over Pipeline Complexity

**What:** Add intelligence by enriching the prompt text, not by adding pre/post-processing AI stages.

**When:** Any time you want to change how Claude reviews code.

**Why:** The existing architecture routes all intelligence through a single `query()` call. Adding pre-processing AI calls (e.g., a "triage" agent) would double latency and cost. Prompt enrichment is free and maintains the single-execution model.

**Example:**
```typescript
// GOOD: Enrich the prompt
const prompt = buildReviewPrompt({
  ...baseContext,
  learnings: await knowledgeStore.getForRepo(repo),
  diffAnalysis: analyzeDiff(workspace, baseBranch, changedFiles),
  reviewMode: config.review.mode,
});

// BAD: Add a pre-processing AI call
const triage = await triageAgent.analyze(diff);  // Extra $$$, extra latency
const prompt = buildReviewPrompt({ ...baseContext, triage });
```

### Pattern 2: SQLite Factory Functions

**What:** New persistent stores use the same factory function pattern as telemetry.

**When:** Adding any new persistent storage.

**Why:** Consistency with existing codebase. `createKnowledgeStore({ dbPath, logger })` mirrors `createTelemetryStore({ dbPath, logger })`.

**Example:**
```typescript
// Same pattern as telemetry store
export function createKnowledgeStore(opts: {
  dbPath: string;
  logger: Logger;
}): KnowledgeStore {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");
  // ... create tables, prepare statements
  return { getForRepo, addLearning, updateUsage, close };
}
```

### Pattern 3: Config-Driven Prompt Sections

**What:** Review mode and severity settings map to prompt text sections, not code branches.

**When:** Adding any configurable review behavior.

**Why:** The prompt is the single source of truth for review behavior. Code branches for different modes would create maintenance burden and testing complexity. String templates are simpler.

### Pattern 4: Bounded Context Injection

**What:** All dynamic context injected into prompts has explicit size limits.

**When:** Injecting learnings, diff analysis, or any variable-length content.

**Why:** Unbounded context can blow up prompt token usage, increasing cost and potentially degrading review quality by diluting the signal.

**Limits:**
- Learnings: max 20 entries, max 2000 characters
- Diff analysis summary: max 500 characters
- Risk signals: max 10 signals
- Custom rules: max 10 rules, max 2000 characters total

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Multi-Agent Review Pipeline

**What:** Using separate AI agents for triage, analysis, and formatting.

**Why bad:** Doubles or triples cost and latency. The existing single-agent model works well. Claude is capable of doing triage, analysis, and formatting in one pass when given good prompt context.

**Instead:** Enrich the prompt. Let Claude do it all in one execution.

### Anti-Pattern 2: Post-Processing Filter on Claude Output

**What:** Running Claude output through a filter that removes low-severity findings after execution.

**Why bad:** Claude already spent tokens generating those findings. Filtering after execution wastes money. Worse, it breaks the structured output format (summary references inline comments that got filtered).

**Instead:** Set severity thresholds in the prompt so Claude never generates low-severity findings.

### Anti-Pattern 3: Storing Learnings in the Workspace

**What:** Writing learnings to a file in the cloned repo workspace.

**Why bad:** Workspaces are ephemeral -- cleaned up after every job. Learnings would be lost. Also, writing to the workspace risks polluting the git state.

**Instead:** Use a separate SQLite database that persists across jobs (same approach as telemetry).

### Anti-Pattern 4: Fine-Grained Feedback Tracking Before Basics Work

**What:** Building complex feedback loops (reaction tracking, resolution analysis, confidence Bayesian updates) before the basic review improvements are validated.

**Why bad:** Premature complexity. The biggest review quality wins come from better prompts (severity instructions, review modes) and simple config-defined patterns. Feedback loops are a refinement, not a foundation.

**Instead:** Ship config-defined patterns and review modes first. Add feedback capture as a separate, later phase.

### Anti-Pattern 5: Separate Knowledge Database Per Installation

**What:** Creating a separate SQLite file per GitHub installation.

**Why bad:** Complicates backup, migration, and monitoring. The telemetry store already uses a single DB with repo-level filtering, and it works well.

**Instead:** Single knowledge database with repo column for filtering. Same as telemetry.

---

## Scalability Considerations

| Concern | At 10 repos | At 100 repos | At 1000 repos |
|---------|-------------|--------------|---------------|
| Knowledge DB size | <1 MB | <10 MB | <100 MB |
| Learnings query time | <1ms | <5ms | <10ms (indexed) |
| Prompt size growth | Negligible (bounded) | Negligible (bounded) | Negligible (bounded) |
| Diff analysis time | <100ms | <100ms | <100ms (deterministic) |
| Config schema load | <1ms | <1ms | <1ms |

The bounded context injection pattern ensures that prompt size does not grow with the number of repos or accumulated learnings. Each review only loads the top 20 learnings for its specific repo.

---

## Build Order (Dependency-Driven)

Components must be built in this order because of dependencies:

### Phase A: Config Extension (no dependencies)
1. Add `review.mode`, `review.severity`, `review.patterns` to zod schema
2. Add defaults and section-level fallback parsing
3. Tests for new config fields

**Can be built independently.** No other component depends on this being integrated.

### Phase B: Diff Analyzer (no dependencies)
1. Create `src/execution/diff-analysis.ts`
2. File classification by extension/path
3. Risk signal detection
4. Scale indicators
5. Tests with sample diffs

**Can be built independently.** Pure function, no external dependencies.

### Phase C: Review Prompt Enhancement (depends on A, B)
1. Modify `buildReviewPrompt()` to accept new parameters
2. Add review mode instruction sections
3. Add severity classification guidance
4. Add diff analysis context section
5. Add learnings section (placeholder until D)
6. Tests for prompt generation with various configs

**Depends on A** for config types and **B** for diff analysis types. This is the integration point.

### Phase D: Knowledge Store (no dependencies, parallel with A/B)
1. Create `src/knowledge/store.ts` and `src/knowledge/types.ts`
2. SQLite schema (learnings table)
3. CRUD operations: getForRepo, addLearning, updateUsage
4. Factory function following telemetry pattern
5. Tests

**Can be built independently.** Does not depend on config or diff analysis.

### Phase E: Handler Integration (depends on A, B, C, D)
1. Wire knowledge store into review handler
2. Load learnings before prompt building
3. Run diff analysis before prompt building
4. Pass enriched context to `buildReviewPrompt()`
5. Update learning usage counts after execution
6. Initialize knowledge store in `src/index.ts`
7. Integration tests

**Depends on all previous phases.** This is the final wiring step.

### Phase F: Comment Server Enhancement (depends on A)
1. Update severity heading validation to respect configured levels
2. Add validation for mode-specific output expectations
3. Tests

**Depends on A** for severity config. Can run in parallel with C/D/E after A is done.

### Dependency Graph

```
A (Config) ────────┬──────> C (Prompt) ──────> E (Integration)
                   │              ^                    ^
B (Diff Analyzer) ─┘              │                    │
                                  │                    │
D (Knowledge Store) ──────────────┴────────────────────┘

F (Comment Server) <── A (Config)
```

**Parallelism opportunity:** A, B, and D can all be built in parallel. C requires A+B. E requires everything. F requires only A.

---

## Configuration Impact Summary

### New `.kodiai.yml` Fields

```yaml
review:
  # Existing fields (unchanged)
  enabled: true
  autoApprove: true
  triggers: { onOpened: true, onReadyForReview: true, onReviewRequested: true }
  prompt: "Custom instructions..."
  skipAuthors: []
  skipPaths: []

  # NEW fields for v0.4
  mode: "balanced"            # "strict" | "balanced" | "lenient"
  severity:
    minLevel: "minor"         # Minimum severity to report
  patterns:
    focus: []                 # Review focus areas
    ignore: []                # Areas to de-emphasize
    customRules: []           # Free-text repo-specific rules
```

### Defaults (Zero-Config Still Works)

| Field | Default | Rationale |
|-------|---------|-----------|
| `review.mode` | `"balanced"` | Current behavior preserved |
| `review.severity.minLevel` | `"minor"` | Report everything (current behavior) |
| `review.patterns.focus` | `[]` | No special focus (current behavior) |
| `review.patterns.ignore` | `[]` | Nothing ignored (current behavior) |
| `review.patterns.customRules` | `[]` | No custom rules |

Zero-config repos get exactly the same behavior as v0.3. All new features are opt-in via configuration.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Prompt too long after enrichment | LOW | MEDIUM (increased cost) | Bounded context injection with character limits |
| Knowledge store DB corruption | LOW | LOW (graceful fallback) | Same WAL mode as telemetry; missing learnings = current behavior |
| Review mode causes unexpected behavior | MEDIUM | LOW (config is opt-in) | Default is "balanced" which matches current behavior |
| Diff analyzer misclassifies files | LOW | LOW (informational only) | Risk signals are hints, not gates. Claude still reads the full diff. |
| Config migration breaks existing repos | LOW | HIGH (reviews stop working) | Section-level fallback parsing already exists. New fields have defaults. |

---

## Sources

- Codebase analysis: Full read of `src/handlers/review.ts`, `src/execution/executor.ts`, `src/execution/review-prompt.ts`, `src/execution/config.ts`, `src/jobs/queue.ts`, `src/jobs/workspace.ts`, `src/execution/mcp/*.ts`, `src/telemetry/store.ts`, `src/index.ts`
- [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration) -- learnings scope, review profiles, path instructions
- [Anthropic claude-code-security-review](https://github.com/anthropics/claude-code-security-review) -- severity classification, false positive filtering pipeline
- [Qodo AI code review patterns 2026](https://www.qodo.ai/blog/5-ai-code-review-pattern-predictions-in-2026/) -- adaptive severity calibration, attribution-based learning
- [Kilo AI code reviews](https://blog.kilo.ai/p/introducing-code-reviews) -- strict/balanced/lenient review modes
- [Reducing False Positives with LLMs](https://arxiv.org/abs/2601.18844) -- hybrid LLM+static analysis eliminates 94-98% false positives
- [Graphite: Effective prompt engineering for AI code reviews](https://graphite.com/guides/effective-prompt-engineering-ai-code-reviews) -- context engineering patterns
- [Microsoft: Enhancing Code Quality at Scale](https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/) -- configurable severity, repository-specific guidelines
