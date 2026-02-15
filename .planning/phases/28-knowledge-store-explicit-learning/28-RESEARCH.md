# Phase 28: Knowledge Store & Explicit Learning - Research

**Researched:** 2026-02-11
**Domain:** SQLite knowledge store, suppression pattern matching, confidence heuristics, review metrics, CLI query commands
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Suppression patterns
- **Format:** Hybrid approach -- string patterns with optional metadata (severity/category/paths)
  - Example: `pattern: "missing error handling"` with optional `severity: [minor, medium]` and `paths: ["**/*test*"]`
- **Scope:** Claude decides based on Phase 27 pathInstructions design (likely global by default with optional path scoping)
- **Interaction with focusAreas:** Claude decides most intuitive behavior (likely independent filters that stack)
- **Pattern syntax:** Support both glob wildcards and regex with format prefix
  - `glob:*test*` for simple matching
  - `regex:missing.*handling` for complex patterns
  - Prefix required to distinguish syntax and enable security validation

#### Confidence levels
- **Display format:** Percentage score (0-100%) shown in review output
  - Example: "Missing error handling (72% confidence)"
- **Source:** Heuristic-based scoring calculated from deterministic signals
  - No reliance on Claude self-assessment -- confidence computed from observable factors
- **Threshold behavior:** Soft filter with separate section
  - Low-confidence findings shown in collapsible "Low Confidence Findings" section
  - Users see everything but can focus on high-confidence issues first
- **Scoring signals:** Confidence heuristics use all three signals:
  - **Severity level** -- Critical/major findings score higher
  - **Category type** -- Security/bugs higher confidence than maintainability
  - **Pattern matching strength** -- Findings matching known patterns score higher

#### Review metrics
- **Standard metrics in every summary:**
  - Files and lines analyzed: "Reviewed 12 files, 847 lines changed"
  - Issues by severity: "Found 2 major, 5 medium, 3 minor issues"
- **Placement:** Metrics appear in collapsible "Review Details" section
  - Keeps main summary focused on findings
  - Users can expand for quantitative context
- **Historical tracking:** Yes, full history persisted
  - Store every review's metrics in knowledge store for trend analysis
  - Enables future reporting capabilities
- **Suppression counting:** Separate suppression metrics
  - Show both sections: active findings and suppressed findings
  - Example: "Found 5 major (3 shown, 2 suppressed)"

#### Knowledge store structure
- **Persisted data:** All of the above -- comprehensive storage
  - **Finding details:** Issue type, severity, category, confidence, file path, line numbers
  - **Review metadata:** PR number, repo, timestamp, config used, files analyzed, lines changed
  - **Suppression matches:** Which suppressions fired and what they blocked
- **Scope:** Both per-repo + optional global
  - Each repo's findings isolated by default (clean boundaries)
  - Optional global store for anonymized pattern sharing across repos
  - Users opt-in to global knowledge sharing
- **Retention policy:** Keep forever
  - Never delete historical reviews
  - Enables long-term trend analysis and learning improvements
  - Storage growth acceptable given SQLite efficiency
- **User access:** CLI query commands
  - Add commands like `kodiai-cli stats --repo=owner/name` for on-demand queries
  - Enable trend analysis: `kodiai-cli trends --repo=owner/name --last-30-days`
  - No direct database export (security boundary)

### Claude's Discretion
- Exact suppression pattern matching algorithm
- Confidence scoring formula calibration
- SQLite schema design and indexing strategy
- CLI command interface details
- Global knowledge store anonymization approach

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope. Automated learning and feedback loops are explicitly in Phase 29.
</user_constraints>

## Summary

Phase 28 adds four capabilities to Kodiai: (1) a SQLite knowledge store that persists review findings, metrics, and suppression history alongside the existing telemetry database; (2) user-configurable suppression patterns in `.kodiai.yml` that filter out unwanted findings; (3) heuristic-based confidence scoring that separates high-confidence from low-confidence findings in review output; and (4) quantitative review metrics embedded in every review summary with CLI commands for historical analysis.

The implementation builds directly on established codebase patterns. The knowledge store follows the exact same `createXxxStore({ dbPath, logger })` factory function pattern as the existing `createTelemetryStore()` in `src/telemetry/store.ts`, using `bun:sqlite` with WAL mode, prepared statements, and auto-checkpointing. The suppression config extends the Zod schema in `src/execution/config.ts` following the same array-of-objects pattern used by `pathInstructions`. The review prompt in `src/execution/review-prompt.ts` gains new sections for suppression rules, confidence display instructions, and metrics formatting. The review handler in `src/handlers/review.ts` becomes the integration point that loads suppressions, computes confidence, collects metrics, and persists findings after execution.

The CLI commands follow the existing `scripts/usage-report.ts` pattern -- standalone scripts that open the SQLite database in read-only mode using `bun:sqlite` with `util.parseArgs()` for argument parsing. No new npm dependencies are needed for any feature in this phase.

**Primary recommendation:** Implement as four plans: (1) Knowledge store schema and factory function, (2) Suppression patterns config and matching engine, (3) Confidence heuristics and review metrics integration, (4) CLI query commands and handler wiring. All code uses existing dependencies and established patterns.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:sqlite` | (builtin) | Knowledge store database | Already used by `createTelemetryStore()`. Native, 3-6x faster than better-sqlite3. WAL mode, prepared statements, transactions supported. |
| `zod` | ^4.3.6 | Config schema for `review.suppressions` and `review.minConfidence` | Already used for all `.kodiai.yml` parsing. Phase 26/27 established the pattern for adding review sub-schemas. |
| `picomatch` | ^4.0.2 | Glob pattern matching for suppression path scoping | Already used for `skipPaths`, `pathInstructions`, and file categories. |
| `js-yaml` | ^4.1.1 | YAML config parsing | Already used by `loadRepoConfig()`. No changes needed. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `util.parseArgs` | (builtin) | CLI argument parsing for `kodiai-cli` commands | Already used by `scripts/usage-report.ts`. Supports subcommands via positionals. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `bun:sqlite` JSON columns | Separate normalized tables | JSON columns are simpler for variable-shape data (suppression metadata, config snapshots). SQLite's JSON1 extension (built-in since 3.38.0) provides `json_extract()` for queries. Use normalized tables for frequently-queried fields (repo, severity, category). |
| New regex library for pattern matching | Built-in `RegExp` | Native `RegExp` is sufficient. The `regex:` prefix syntax just constructs a `new RegExp()`. No library needed. |
| Commander.js / yargs for CLI | `util.parseArgs` | The existing `usage-report.ts` uses `parseArgs` successfully. Adding a CLI framework for two commands is overkill. |

**Installation:**
```bash
# No new packages needed -- all requirements use existing dependencies
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── knowledge/
│   ├── store.ts            # NEW: SQLite knowledge store factory (follows telemetry/store.ts pattern)
│   ├── store.test.ts       # NEW: Knowledge store unit tests
│   ├── types.ts            # NEW: Type definitions for findings, reviews, suppressions
│   └── confidence.ts       # NEW: Heuristic confidence scoring engine
├── execution/
│   ├── config.ts           # MODIFIED: add review.suppressions, review.minConfidence
│   ├── config.test.ts      # MODIFIED: tests for new config fields
│   ├── review-prompt.ts    # MODIFIED: add suppression rules, confidence display, metrics sections
│   └── review-prompt.test.ts # MODIFIED: tests for new prompt sections
├── handlers/
│   └── review.ts           # MODIFIED: integrate knowledge store, apply suppressions, collect metrics
├── index.ts                # MODIFIED: initialize knowledge store alongside telemetry
scripts/
├── usage-report.ts         # EXISTING: unchanged
├── kodiai-stats.ts         # NEW: CLI for review stats (bun scripts/kodiai-stats.ts)
└── kodiai-trends.ts        # NEW: CLI for trend analysis (bun scripts/kodiai-trends.ts)
```

### Pattern 1: Knowledge Store Factory (mirrors telemetry store)

**What:** A `createKnowledgeStore({ dbPath, logger })` factory function that returns a `KnowledgeStore` interface with methods for recording findings, querying stats, and managing suppressions. Uses the exact same SQLite setup pattern as `createTelemetryStore()`.

**When to use:** At application startup in `src/index.ts`, alongside telemetry store initialization.

**Why:** Established project pattern. The telemetry store proves this approach works for fire-and-forget writes from handlers.

**Example:**
```typescript
// Source: mirrors src/telemetry/store.ts pattern exactly
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type { KnowledgeStore, ReviewRecord, FindingRecord } from "./types.ts";

export function createKnowledgeStore(opts: {
  dbPath: string;
  logger: Logger;
}): KnowledgeStore {
  const { dbPath, logger } = opts;

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, { create: true });

  // Same PRAGMAs as telemetry store
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");

  // Schema creation (idempotent)
  // ... tables, indexes, prepared statements

  return store;
}
```

### Pattern 2: Suppression Pattern Matching with Dual Syntax

**What:** Suppression patterns support two syntaxes: `glob:*test*` for simple glob matching and `regex:missing.*handling` for complex patterns. The prefix is required to distinguish syntax and enable security validation. Unprefixed strings are treated as substring matches (most intuitive for simple cases like `"missing error handling"`).

**When to use:** During review prompt construction, before findings are reported. Suppressions are injected into the prompt as "do not flag these patterns" instructions. Post-execution, the handler also checks suppression patterns against structured findings for metrics.

**Why:** The prefix approach is explicitly locked in CONTEXT.md. Separating glob from regex prevents ambiguity and allows security validation (e.g., rejecting catastrophic backtracking regex patterns).

**Example:**
```typescript
type SuppressionPattern = {
  pattern: string;            // "missing error handling" or "glob:*test*" or "regex:missing.*handling"
  severity?: string[];        // Optional: only suppress at these levels ["minor", "medium"]
  category?: string[];        // Optional: only suppress these categories ["style"]
  paths?: string[];           // Optional: only suppress in these paths ["**/*test*"]
};

function matchesSuppression(
  finding: { text: string; severity: string; category: string; filePath: string },
  suppression: SuppressionPattern,
): boolean {
  // 1. Match pattern against finding text
  const patternMatches = matchPattern(suppression.pattern, finding.text);
  if (!patternMatches) return false;

  // 2. Check optional severity filter
  if (suppression.severity && !suppression.severity.includes(finding.severity)) return false;

  // 3. Check optional category filter
  if (suppression.category && !suppression.category.includes(finding.category)) return false;

  // 4. Check optional path filter (using picomatch)
  if (suppression.paths) {
    const pathMatches = suppression.paths.some(p => picomatch(p, { dot: true })(finding.filePath));
    if (!pathMatches) return false;
  }

  return true;
}

function matchPattern(pattern: string, text: string): boolean {
  if (pattern.startsWith("glob:")) {
    return picomatch(pattern.slice(5), { dot: true })(text);
  }
  if (pattern.startsWith("regex:")) {
    try {
      return new RegExp(pattern.slice(6), "i").test(text);
    } catch {
      return false; // Invalid regex fails silently
    }
  }
  // Default: case-insensitive substring match
  return text.toLowerCase().includes(pattern.toLowerCase());
}
```

### Pattern 3: Heuristic Confidence Scoring

**What:** A pure function that computes a 0-100% confidence score for each finding based on deterministic signals: severity level, category type, and pattern matching strength.

**When to use:** After Claude generates findings but before they are displayed. The confidence score is computed by the prompt instruction layer -- Claude is told to output structured finding data, and the handler applies the scoring formula.

**Why:** The locked decision specifies heuristic-based scoring from observable factors, not Claude self-assessment. This keeps confidence deterministic and consistent.

**Example:**
```typescript
interface ConfidenceInput {
  severity: "critical" | "major" | "medium" | "minor";
  category: "security" | "correctness" | "performance" | "style" | "documentation";
  matchesKnownPattern: boolean;  // True if finding matches a pattern from the knowledge store
}

function computeConfidence(input: ConfidenceInput): number {
  let score = 50; // Base confidence

  // Severity signal (critical = highest confidence)
  const severityBoost: Record<string, number> = {
    critical: 30, major: 20, medium: 10, minor: 0,
  };
  score += severityBoost[input.severity] ?? 0;

  // Category signal (security/correctness = higher confidence)
  const categoryBoost: Record<string, number> = {
    security: 15, correctness: 10, performance: 5, style: -5, documentation: -10,
  };
  score += categoryBoost[input.category] ?? 0;

  // Pattern matching signal
  if (input.matchesKnownPattern) score += 10;

  return Math.max(0, Math.min(100, score));
}
```

### Pattern 4: Review Metrics Collection

**What:** After review execution, the handler collects quantitative metrics (files analyzed, lines changed, issues by severity, suppressions applied) and persists them in the knowledge store alongside finding details.

**When to use:** In the review handler, after execution completes and before telemetry recording.

**Why:** Metrics appear in the review summary comment and are stored for historical trend analysis.

### Pattern 5: CLI Script Pattern (mirrors usage-report.ts)

**What:** Standalone scripts in `scripts/` that open the knowledge store SQLite database in read-only mode and output formatted results. Use `util.parseArgs` for argument parsing with `--repo`, `--since`, `--json` flags.

**When to use:** On-demand by operators via `bun scripts/kodiai-stats.ts --repo=owner/name`.

**Why:** The existing `scripts/usage-report.ts` proves this pattern works. Self-contained scripts that do NOT import from `src/` -- they open the database directly with `bun:sqlite`.

### Anti-Patterns to Avoid
- **Storing suppression patterns in the knowledge DB:** Suppressions live in `.kodiai.yml` config (version-controlled). The DB stores which suppressions fired, not the patterns themselves.
- **Claude computing confidence scores:** The locked decision says "no reliance on Claude self-assessment". Confidence is computed from deterministic signals post-execution.
- **Single combined metrics + findings table:** Keep reviews and findings in separate tables. Reviews are one-per-PR; findings are many-per-review. Normalization enables efficient queries.
- **Running knowledge store queries during prompt build:** The knowledge store is read-after-write only in Phase 28. Phase 29 adds read-during-build for learned patterns. Keep the scope tight.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite database management | Custom connection pool / ORM | `bun:sqlite` Database class with factory function | Bun's native SQLite is 3-6x faster than alternatives. The telemetry store pattern handles WAL, busy timeout, and directory creation. |
| Glob pattern matching for paths | Custom glob parser | `picomatch` (already installed, v4.0.2) | 14+ edge cases in glob matching (braces, character classes, dotfiles). picomatch handles all of them. |
| Regex safety validation | Custom regex timeout | `try/catch` around `new RegExp()` | JavaScript's `RegExp` constructor throws on invalid patterns. For production, consider a regex complexity limit (max length, no nested quantifiers). |
| CLI argument parsing | Manual `process.argv` parsing | `util.parseArgs` from `node:util` | Already used in `scripts/usage-report.ts`. Handles flags, positionals, short options. |
| YAML config parsing | Custom parser | `js-yaml` + `zod` (already used) | Established config loading pattern in `loadRepoConfig()`. |
| Date/time formatting for CLI output | Manual string formatting | `Date.toISOString()` / `toLocaleString()` | Built-in, no dependency needed. |

**Key insight:** Phase 28 adds persistent storage and configuration -- both are patterns the codebase already implements. The knowledge store mirrors telemetry, the config extends the review schema, and the CLI mirrors the usage report. No new architectural patterns are needed.

## Common Pitfalls

### Pitfall 1: Suppression Pattern Security (ReDoS)
**What goes wrong:** A user configures `regex:.*.*.*.*.*.*a` which causes catastrophic backtracking.
**Why it happens:** The `regex:` prefix allows arbitrary regular expressions. Malicious or poorly-written patterns can hang the process.
**How to avoid:** Validate regex patterns at config parse time: (1) reject patterns longer than 200 characters, (2) reject patterns with nested quantifiers (e.g., `.*.*`), (3) wrap `new RegExp()` in try/catch, (4) apply a 100ms timeout when testing patterns during config validation. Log a config warning (not error) for invalid patterns.
**Warning signs:** Review latency spikes when processing repos with complex suppression patterns.

### Pitfall 2: Knowledge Store Schema Migration
**What goes wrong:** Adding columns to existing tables after deployment breaks existing databases.
**Why it happens:** SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (until SQLite 3.35.0+, and even then the syntax is limited).
**How to avoid:** Use `CREATE TABLE IF NOT EXISTS` for all tables (already the pattern in telemetry store). For future schema changes, add columns with `ALTER TABLE ... ADD COLUMN` wrapped in a try/catch that ignores "duplicate column name" errors. Never drop columns. Never rename columns. Document schema version in a metadata field or table.
**Warning signs:** Application crashes on startup with "table already has column" errors.

### Pitfall 3: Confidence Score Prompt/Handler Mismatch
**What goes wrong:** The prompt instructs Claude to include confidence percentages in findings, but Claude's output format does not consistently include parseable confidence data. The handler cannot extract structured finding data to apply heuristic scoring.
**Why it happens:** Claude's output is unstructured text. Parsing arbitrary text for severity, category, and confidence is fragile.
**How to avoid:** Use the existing enhanced mode YAML metadata approach from Phase 26. In enhanced mode, each inline comment starts with a fenced YAML block containing `severity` and `category`. The confidence score is computed by the handler using these structured fields -- Claude never outputs a confidence number. For standard mode, confidence scoring applies only to the summary comment structure (severity headings provide the signal).
**Warning signs:** Confidence scores are always the same value because Claude's output lacks parseable severity/category data.

### Pitfall 4: Metrics Collection Blocking Review Execution
**What goes wrong:** If the knowledge store write fails (disk full, database locked), the review handler errors out and the user gets an error comment instead of their review.
**Why it happens:** Knowledge store writes are in the critical path of the review handler.
**How to avoid:** Follow the telemetry store pattern -- fire-and-forget writes wrapped in try/catch. Knowledge store writes MUST NEVER fail the review job. Log a warning on failure but continue to post the review. This is the exact pattern at lines 716-737 of `src/handlers/review.ts` for telemetry.
**Warning signs:** Review failures that correlate with disk space alerts.

### Pitfall 5: Suppression Matching Against Prompt Output vs Structured Data
**What goes wrong:** Suppressions are designed to match against finding text (e.g., "missing error handling"), but Claude's output text is variable. The same issue might be described as "no error handling", "error handling missing", or "unhandled exception".
**Why it happens:** Natural language is inherently variable. String matching against LLM output is unreliable.
**How to avoid:** Two-layer approach: (1) Inject suppression rules into the prompt so Claude knows NOT to flag suppressed patterns (prompt-level prevention). (2) Post-execution, apply suppression matching against structured metadata (severity + category + file path) rather than freeform text. The `paths` filter is the most reliable suppression signal because file paths are deterministic.
**Warning signs:** Users report that suppression patterns "don't work" because Claude describes the same issue differently.

### Pitfall 6: Global Knowledge Store Privacy Concerns
**What goes wrong:** The global store shares finding patterns across repos, but finding details may contain sensitive information (file paths, code snippets, internal naming).
**Why it happens:** The locked decision says "anonymized pattern sharing" but defining "anonymized" for code review findings is non-trivial.
**How to avoid:** Phase 28 defers the global store to "optional" and focuses on per-repo storage. For the global store, anonymize by: (1) storing only category + severity distribution (no file paths, no code), (2) aggregating counts rather than individual findings, (3) requiring explicit opt-in via config. The simplest global store is a frequency table: "security findings occur 3x more often in repos with these config settings."
**Warning signs:** A user requests GDPR deletion and the global store contains identifiable repo patterns.

## Code Examples

Verified patterns from the existing codebase and official documentation:

### SQLite Knowledge Store Schema

```sql
-- Reviews table: one row per review execution
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT,
  delivery_id TEXT,
  -- Metrics
  files_analyzed INTEGER NOT NULL DEFAULT 0,
  lines_changed INTEGER NOT NULL DEFAULT 0,
  -- Finding counts by severity
  findings_critical INTEGER NOT NULL DEFAULT 0,
  findings_major INTEGER NOT NULL DEFAULT 0,
  findings_medium INTEGER NOT NULL DEFAULT 0,
  findings_minor INTEGER NOT NULL DEFAULT 0,
  findings_total INTEGER NOT NULL DEFAULT 0,
  -- Suppression counts
  suppressions_applied INTEGER NOT NULL DEFAULT 0,
  -- Config snapshot (JSON)
  config_snapshot TEXT,
  -- Execution metadata
  duration_ms INTEGER,
  model TEXT,
  conclusion TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_reviews_repo ON reviews(repo);
CREATE INDEX IF NOT EXISTS idx_reviews_repo_created ON reviews(repo, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_pr ON reviews(repo, pr_number);

-- Findings table: individual findings per review
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Finding details
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  severity TEXT NOT NULL,           -- 'critical' | 'major' | 'medium' | 'minor'
  category TEXT NOT NULL,           -- 'security' | 'correctness' | 'performance' | 'style' | 'documentation'
  confidence INTEGER NOT NULL,      -- 0-100
  title TEXT NOT NULL,
  -- Resolution
  suppressed INTEGER NOT NULL DEFAULT 0,
  suppression_pattern TEXT           -- Which pattern caused suppression (if any)
);

CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_repo_file ON findings(file_path);

-- Suppression log: which patterns fired per review
CREATE TABLE IF NOT EXISTS suppression_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  pattern TEXT NOT NULL,             -- The suppression pattern that matched
  matched_count INTEGER NOT NULL DEFAULT 0,
  finding_ids TEXT                    -- JSON array of finding IDs that were suppressed
);

CREATE INDEX IF NOT EXISTS idx_suppression_log_review ON suppression_log(review_id);
```

### Config Schema Extension for Suppressions

```typescript
// Source: extends existing reviewSchema in src/execution/config.ts

const suppressionPatternSchema = z.object({
  pattern: z.string().min(1),
  severity: z.array(
    z.enum(["critical", "major", "medium", "minor"])
  ).optional(),
  category: z.array(
    z.enum(["security", "correctness", "performance", "style", "documentation"])
  ).optional(),
  paths: z.array(z.string()).optional(),
});

// Add to reviewSchema:
// Simple string patterns or full objects
const suppressionItemSchema = z.union([
  z.string().min(1),  // Simple: "missing error handling"
  suppressionPatternSchema,
]);

// In the review section:
suppressions: z.array(suppressionItemSchema).default([]),
minConfidence: z.number().min(0).max(100).default(0),
```

### Example .kodiai.yml with Suppressions

```yaml
review:
  enabled: true
  mode: enhanced
  severity:
    minLevel: medium

  # Suppression patterns (LEARN-02)
  suppressions:
    # Simple string pattern (substring match)
    - "missing JSDoc comments"

    # Glob pattern
    - pattern: "glob:*unused import*"
      severity: [minor]

    # Regex pattern with path scoping
    - pattern: "regex:missing.*error.*handling"
      severity: [minor, medium]
      paths: ["**/*test*", "scripts/**"]

    # Category-scoped suppression
    - pattern: "style preference"
      category: [style]

  # Confidence threshold (LEARN-03)
  minConfidence: 40  # Show findings above 40% confidence; below goes to collapsible section
```

### Knowledge Store Interface

```typescript
// Source: new file src/knowledge/types.ts

export type ReviewRecord = {
  repo: string;
  prNumber: number;
  headSha?: string;
  deliveryId?: string;
  filesAnalyzed: number;
  linesChanged: number;
  findingsCritical: number;
  findingsMajor: number;
  findingsMedium: number;
  findingsMinor: number;
  findingsTotal: number;
  suppressionsApplied: number;
  configSnapshot?: string;  // JSON string of review config
  durationMs?: number;
  model?: string;
  conclusion: string;
};

export type FindingRecord = {
  reviewId: number;
  filePath: string;
  startLine?: number;
  endLine?: number;
  severity: string;
  category: string;
  confidence: number;
  title: string;
  suppressed: boolean;
  suppressionPattern?: string;
};

export type SuppressionLogEntry = {
  reviewId: number;
  pattern: string;
  matchedCount: number;
  findingIds?: number[];
};

export type KnowledgeStore = {
  /** Record a review execution with its metrics */
  recordReview(entry: ReviewRecord): number;  // Returns review ID

  /** Record individual findings for a review */
  recordFindings(findings: FindingRecord[]): void;

  /** Record which suppression patterns fired */
  recordSuppressionLog(entries: SuppressionLogEntry[]): void;

  /** Query review stats for a repo */
  getRepoStats(repo: string, sinceDays?: number): RepoStats;

  /** Query trend data for a repo */
  getRepoTrends(repo: string, days: number): TrendData[];

  /** Run a WAL checkpoint (PASSIVE mode) */
  checkpoint(): void;

  /** Close the database connection */
  close(): void;
};

export type RepoStats = {
  totalReviews: number;
  totalFindings: number;
  findingsBySeverity: Record<string, number>;
  totalSuppressed: number;
  avgFindingsPerReview: number;
  avgConfidence: number;
  topFiles: Array<{ path: string; findingCount: number }>;
};

export type TrendData = {
  date: string;
  reviewCount: number;
  findingsCount: number;
  suppressionsCount: number;
  avgConfidence: number;
};
```

### CLI Stats Script Pattern

```typescript
// Source: follows scripts/usage-report.ts pattern exactly

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "util";

const DEFAULT_DB_PATH = "./data/kodiai-knowledge.db";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    repo: { type: "string" },
    since: { type: "string" },
    json: { type: "boolean", default: false },
    db: { type: "string", default: DEFAULT_DB_PATH },
    help: { type: "boolean", default: false, short: "h" },
  },
  strict: true,
});

// Open database in read-only mode (same as usage-report.ts)
const db = new Database(resolve(values.db!), { readonly: true });
db.run("PRAGMA busy_timeout = 5000");

// Query and format output...
```

### Prompt Section for Suppression Rules

```typescript
// Source: new section in src/execution/review-prompt.ts

function buildSuppressionRulesSection(
  suppressions: Array<string | SuppressionPattern>,
): string {
  if (suppressions.length === 0) return "";

  const lines: string[] = [
    "## Suppression Rules",
    "",
    "The following patterns should NOT be flagged in this review:",
    "",
  ];

  for (const s of suppressions) {
    if (typeof s === "string") {
      lines.push(`- Do not flag findings matching: "${s}"`);
    } else {
      let rule = `- Do not flag findings matching: "${s.pattern}"`;
      if (s.severity) rule += ` (only at severity: ${s.severity.join(", ")})`;
      if (s.category) rule += ` (only in categories: ${s.category.join(", ")})`;
      if (s.paths) rule += ` (only in paths: ${s.paths.join(", ")})`;
      lines.push(rule);
    }
  }

  lines.push(
    "",
    "If a finding matches any suppression rule above, do NOT report it as an inline comment.",
    "Still count suppressed findings in your mental tally for the metrics section.",
  );

  return lines.join("\n");
}
```

### Metrics Section in Review Summary

```typescript
// Source: new section format for review summary comment

function buildMetricsSection(metrics: {
  filesAnalyzed: number;
  linesChanged: number;
  findingsBySeverity: Record<string, number>;
  suppressionsApplied: number;
  totalFindings: number;
}): string {
  const severityBreakdown = Object.entries(metrics.findingsBySeverity)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(", ");

  const shown = metrics.totalFindings - metrics.suppressionsApplied;
  const suppressionNote = metrics.suppressionsApplied > 0
    ? ` (${shown} shown, ${metrics.suppressionsApplied} suppressed)`
    : "";

  return [
    "<details>",
    "<summary>Review Details</summary>",
    "",
    `Reviewed ${metrics.filesAnalyzed} files, ${metrics.linesChanged} lines changed`,
    `Found ${severityBreakdown}${suppressionNote}`,
    "",
    "</details>",
  ].join("\n");
}
```

## Discretion Recommendations

### 1. Suppression Pattern Matching Algorithm

**Recommendation: Three-tier matching with prompt-level prevention as primary.**

**Tier 1 -- Prompt Prevention (Primary):** Inject suppression rules into the review prompt so Claude knows not to flag suppressed patterns. This is the most effective approach because it prevents unnecessary token spend on suppressed findings.

**Tier 2 -- Structured Metadata Matching (Secondary):** After execution, match suppression patterns against structured output metadata (severity, category, file path) from enhanced mode YAML blocks. This provides a deterministic fallback.

**Tier 3 -- Text Substring Matching (Tertiary):** For standard mode, match simple string patterns against finding titles in the summary comment. This is the least reliable tier but catches obvious matches.

**Interaction with focusAreas:** Suppressions and focusAreas are independent, stacking filters. FocusAreas controls what Claude looks for; suppressions control what gets filtered out of results. A finding in a focused area can still be suppressed if it matches a suppression pattern. This is the most intuitive behavior -- "look for security issues but ignore the known false positive about X."

### 2. Confidence Scoring Formula Calibration

**Recommendation: Additive formula with three signals, clamped to 0-100.**

```
confidence = base(50) + severity_boost + category_boost + pattern_boost
```

| Signal | Values |
|--------|--------|
| Base | 50 (all findings start at 50%) |
| Severity boost | critical: +30, major: +20, medium: +10, minor: +0 |
| Category boost | security: +15, correctness: +10, performance: +5, style: -5, documentation: -10 |
| Pattern match boost | +10 if finding matches a known pattern from knowledge store |

This produces a range:
- Critical security finding matching known pattern: 50+30+15+10 = 100% (capped)
- Major correctness finding: 50+20+10 = 80%
- Minor style finding: 50+0-5 = 45%
- Minor documentation finding: 50+0-10 = 40%

The formula is deliberately simple and transparent. Users can predict confidence scores from severity and category alone. The scoring runs entirely in the handler as a pure function -- no LLM involvement.

### 3. SQLite Schema Design and Indexing Strategy

**Recommendation: Three normalized tables (reviews, findings, suppression_log) with compound indexes for common query patterns.**

Key design decisions:
- **Separate knowledge DB file** (`./data/kodiai-knowledge.db`): Different retention policy (keep forever vs telemetry's 90-day purge), different access patterns (read for stats vs write-heavy telemetry). Keeps concerns separated.
- **Foreign keys enabled** (`PRAGMA foreign_keys = ON`): The telemetry store does not use foreign keys (single table), but the knowledge store has relationships (reviews -> findings, reviews -> suppression_log). FK enforcement prevents orphaned records.
- **Config snapshot as JSON column:** The config used for each review changes over time. Storing a JSON snapshot preserves the state at review time. Use `json_extract()` for queries if needed.
- **Compound index on `(repo, created_at)`:** Most common query pattern is "show me reviews for this repo in the last N days."
- **No retention purge:** The locked decision says "keep forever." Unlike telemetry (90-day purge), the knowledge store grows indefinitely. At ~1KB per review + 500B per finding, 10 findings per review, and 5 reviews per day = ~75KB/day = ~27MB/year. Acceptable for SQLite.

### 4. CLI Command Interface Details

**Recommendation: Two standalone scripts following the usage-report.ts pattern.**

**`bun scripts/kodiai-stats.ts`** -- Review statistics for a repo
```
Usage: bun scripts/kodiai-stats.ts [options]

Options:
  --repo <owner/name>   Repository to query (required)
  --since <value>       Filter by time (e.g., 7d, 30d, 2026-01-01)
  --json                Output as JSON
  --db <path>           Database path (default: ./data/kodiai-knowledge.db)
  -h, --help            Show help

Example output:
  Kodiai Review Stats: owner/repo
  ==========================================
  Reviews:          42
  Total Findings:   187 (31 suppressed)
  Avg Findings/PR:  4.5
  Avg Confidence:   72%

  By Severity:
    Critical: 8
    Major: 45
    Medium: 89
    Minor: 45

  Top Files:
    src/api/auth.ts       12 findings
    src/handlers/user.ts   8 findings
    src/lib/database.ts    7 findings
```

**`bun scripts/kodiai-trends.ts`** -- Trend analysis over time
```
Usage: bun scripts/kodiai-trends.ts [options]

Options:
  --repo <owner/name>   Repository to query (required)
  --days <number>       Number of days to show (default: 30)
  --json                Output as JSON
  --db <path>           Database path (default: ./data/kodiai-knowledge.db)
  -h, --help            Show help

Example output:
  Kodiai Review Trends: owner/repo (last 30 days)
  ==========================================
  Date        Reviews  Findings  Suppressed  Avg Confidence
  2026-02-10       3        14          2         74%
  2026-02-09       2         8          1         71%
  ...
```

Both scripts are self-contained -- they do NOT import from `src/`. They open the database directly with `bun:sqlite` in read-only mode. This mirrors the existing `scripts/usage-report.ts` pattern exactly.

### 5. Global Knowledge Store Anonymization Approach

**Recommendation: Defer global store implementation; design schema to support it later.**

The global store is "optional" per the locked decision. For Phase 28, focus on per-repo storage. The schema should support future global aggregation by:
- Using `repo TEXT NOT NULL` on all tables (already planned)
- Not storing code snippets or line content in the findings table
- Storing only structural metadata (severity, category, file extension, line count) that can be safely aggregated

When the global store is implemented (future phase), anonymization means:
1. Strip owner/repo from finding records
2. Replace file paths with extensions only (e.g., `*.ts` instead of `src/api/auth.ts`)
3. Aggregate counts by severity + category + file extension
4. Store in a separate `global_patterns` table
5. Require explicit opt-in via `.kodiai.yml`: `knowledge: { shareGlobal: true }`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No review history | Per-repo finding persistence | 2025-2026 (CodeRabbit, Qodo) | Enables trend analysis and learning |
| Manual false positive management | Config-driven suppression patterns | 2024-2025 (industry standard) | Users teach the bot what to ignore |
| LLM self-assessed confidence | Heuristic-based confidence from observable signals | 2025-2026 | More consistent and predictable than LLM self-reports |
| Review without metrics | Quantitative metrics in every summary | 2025-2026 (CodeRabbit, Graphite) | Users see scope and thoroughness of review |
| Single global settings | Per-path suppression scoping | 2025-2026 | Granular control (ignore style in tests, strict in production code) |

**Industry patterns observed:**
- CodeRabbit stores review history and provides learnings summaries
- All major AI review tools now include quantitative metrics (files reviewed, issues found)
- Confidence scoring in AI tools is trending toward heuristic/deterministic approaches rather than LLM self-assessment
- Suppression patterns with glob/regex support are standard in linter configurations (ESLint, Prettier) -- users expect similar control for AI reviews

## Open Questions

1. **Enhanced mode finding parsing for post-execution metrics**
   - What we know: Enhanced mode outputs YAML metadata blocks per inline comment with `severity` and `category` fields. The handler can parse these from the MCP tool call responses.
   - What's unclear: Whether the handler currently receives structured data from MCP tool calls, or only success/failure responses. The `onPublish` callback in the inline review server only signals "something was published" without providing finding details.
   - Recommendation: Extend the `onPublish` callback (or add a parallel `onFinding` callback) to capture structured finding data (severity, category, file, line) from each inline comment creation. This is the cleanest integration point for metrics collection.

2. **Prompt-level suppression effectiveness**
   - What we know: Injecting "do not flag X" rules into the prompt should prevent Claude from generating suppressed findings.
   - What's unclear: Whether Claude consistently respects suppression rules for edge cases (e.g., a critical security finding that also matches a suppression pattern).
   - Recommendation: Suppression rules should include a safety clause: "NEVER suppress findings at CRITICAL severity regardless of suppression patterns." This prevents users from accidentally silencing critical issues.

3. **Config snapshot storage format**
   - What we know: The locked decision says to store "config used" per review. The config is a complex nested object.
   - What's unclear: Whether to store the full config or just review-relevant fields.
   - Recommendation: Store only review-relevant fields as a JSON string: `{ mode, severityMinLevel, focusAreas, ignoredAreas, maxComments, suppressionCount, profile }`. This is ~200 bytes per review and provides the context needed for trend analysis without storing sensitive data.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/telemetry/store.ts` -- Factory function pattern, WAL mode, prepared statements, auto-checkpoint (128 lines)
- Codebase analysis: `src/telemetry/types.ts` -- TelemetryStore interface pattern (41 lines)
- Codebase analysis: `src/execution/config.ts` -- Zod schema structure, section-level fallback, reviewSchema pattern (383 lines)
- Codebase analysis: `src/execution/review-prompt.ts` -- Prompt section assembly, truncation, noise suppression rules (579 lines)
- Codebase analysis: `src/handlers/review.ts` -- Review pipeline, diff analysis integration, telemetry write pattern (927 lines)
- Codebase analysis: `src/execution/diff-analysis.ts` -- DiffAnalysis type, analyzeDiff pure function, picomatch usage (279 lines)
- Codebase analysis: `src/index.ts` -- App initialization, telemetry store wiring, env vars (92 lines)
- Codebase analysis: `scripts/usage-report.ts` -- CLI script pattern, read-only DB, parseArgs, output formatting (347 lines)
- Codebase analysis: `.planning/research/ARCHITECTURE.md` -- Knowledge store design, SQLite schema, learning sources, prompt integration
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite) -- WAL mode, prepared statements, transactions, Database API
- [SQLite JSON Functions](https://sqlite.org/json1.html) -- json_extract(), JSON1 built-in since SQLite 3.38.0

### Secondary (MEDIUM confidence)
- [SQLite Foreign Key Support](https://sqlite.org/foreignkeys.html) -- `PRAGMA foreign_keys = ON` required to enforce FK constraints
- [How to Build CLI Applications with Bun](https://oneuptime.com/blog/post/2026-01-31-bun-cli-applications/view) -- Subcommand pattern, parseArgs usage, 2026-01-31
- [SQLite Schema Design Best Practices](https://www.sqliteforum.com/p/effective-schema-design-for-sqlite) -- Indexing strategy, normalization guidance

### Tertiary (LOW confidence)
- Global knowledge store anonymization approach -- No industry standard exists; recommendation is based on general privacy principles
- Confidence scoring formula calibration -- Formula values are reasonable estimates; may need tuning after production data is collected

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns verified in existing codebase
- Architecture: HIGH -- knowledge store mirrors telemetry store exactly; config extends established Zod pattern; CLI mirrors usage-report.ts
- Schema design: HIGH -- normalized tables with compound indexes follow SQLite best practices; growth projections calculated
- Suppression matching: MEDIUM -- prompt-level prevention is effective but LLM compliance with suppression rules needs validation
- Confidence scoring: MEDIUM -- formula is reasonable but calibration values are estimates pending production data
- CLI interface: HIGH -- follows proven usage-report.ts pattern
- Pitfalls: HIGH -- all identified pitfalls have concrete prevention strategies based on existing codebase patterns

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable domain -- SQLite patterns and config schemas do not change rapidly)
