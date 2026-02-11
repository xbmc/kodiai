# Technology Stack: v0.4 Intelligent Review System

**Project:** Kodiai GitHub App
**Researched:** 2026-02-11
**Scope:** Stack additions for intelligent review capabilities -- pattern detection, feedback learning, severity classification, review modes

## Current Stack (Verified in Codebase -- DO NOT CHANGE)

| Technology | Installed Version | Purpose |
|------------|-------------------|---------|
| Bun | 1.3.8 | Runtime |
| Hono | ^4.11.8 | HTTP framework |
| @anthropic-ai/claude-agent-sdk | ^0.2.37 | Agent execution (query()) |
| @octokit/rest | ^22.0.1 | GitHub API |
| @octokit/auth-app | ^8.2.0 | GitHub App auth |
| @modelcontextprotocol/sdk | ^1.26.0 | MCP servers |
| zod | ^4.3.6 | Schema validation |
| pino | ^10.3.0 | Structured logging |
| js-yaml | ^4.1.1 | YAML parsing |
| p-queue | ^9.1.0 | Job queue |
| picomatch | ^4.0.2 | Glob matching |
| bun:sqlite | built-in | Telemetry storage (WAL mode) |

**Confidence: HIGH** -- Versions read from `/home/keith/src/kodiai/package.json` and codebase verified.

---

## Critical Architecture Decision: Prompt-Driven Intelligence, Not Library-Driven

Before listing stack additions, the most important decision for v0.4 is what NOT to add.

**Kodiai's review intelligence comes from Claude Code, not from code analysis libraries.** The executor invokes Claude Code via the Agent SDK with `query()`. Claude Code already has access to `Read`, `Grep`, `Glob`, `git diff`, `git log`, and `git show` tools. It can read any file in the workspace, understand ASTs natively (it is a frontier LLM), detect patterns, and reason about code.

**Adding AST parsers (tree-sitter), static analyzers (ESLint as library), or ML classification libraries would be architectural misdirection.** These tools duplicate what Claude Code already does, add dependency complexity, and create a maintenance burden for marginal gain. The industry evidence supports this:

- Greptile's most successful false-positive reduction used embedding-based clustering of feedback, not static analysis ([Greptile blog](https://www.greptile.com/blog/ai-code-review-bubble))
- Claude Code's built-in code-review plugin already uses multi-agent architecture with confidence scoring at >=80 threshold ([Claude Code plugins](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md))
- Academic research shows automated code review with LLMs achieves only 19% F1 with static analysis augmentation -- the bottleneck is false positives from heuristics, not missing analysis capability ([arxiv.org/html/2509.01494v1](https://arxiv.org/html/2509.01494v1))

**The right approach for v0.4 is:**
1. Better prompt construction (enriched context, repo conventions, severity taxonomy)
2. Feedback storage + learning (track which comments were useful/dismissed)
3. Config schema extensions (review modes, severity thresholds, custom rules)
4. Structured output from Claude for downstream processing

**Confidence: HIGH** -- Based on codebase architecture analysis, industry evidence, and Claude Code capabilities.

---

## v0.4 Stack Additions

### 1. Feedback & Learning Storage: `bun:sqlite` (extend existing database)

| Attribute | Value |
|-----------|-------|
| Package | `bun:sqlite` (already in use for telemetry) |
| Install | None required |
| New tables | `review_feedback`, `repo_conventions`, `review_issues` |

**Why extend the existing SQLite database:**

The telemetry store at `./data/kodiai-telemetry.db` already uses `bun:sqlite` with WAL mode. Adding new tables to the same database is the simplest approach -- zero new dependencies, same concurrency model, same backup strategy.

**New tables needed:**

```sql
-- Track individual review comments posted by Kodiai
CREATE TABLE IF NOT EXISTS review_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivery_id TEXT,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  severity TEXT NOT NULL,        -- 'critical', 'major', 'medium', 'minor'
  category TEXT NOT NULL,        -- 'security', 'logic', 'performance', 'maintainability', 'error-handling'
  comment_id INTEGER,            -- GitHub comment ID for tracking feedback
  comment_body TEXT,
  has_suggestion INTEGER DEFAULT 0,
  confidence INTEGER             -- 0-100 confidence score from Claude
);

-- Track user reactions to Kodiai comments (thumbs up/down, resolved, etc.)
CREATE TABLE IF NOT EXISTS review_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,
  review_issue_id INTEGER REFERENCES review_issues(id),
  comment_id INTEGER NOT NULL,   -- GitHub comment ID
  feedback_type TEXT NOT NULL,    -- 'thumbs_up', 'thumbs_down', 'resolved', 'dismissed'
  feedback_source TEXT NOT NULL   -- 'reaction', 'resolution', 'reply'
);

-- Cache repo-specific conventions detected during analysis
CREATE TABLE IF NOT EXISTS repo_conventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,
  convention_type TEXT NOT NULL,  -- 'naming', 'error-handling', 'testing', 'imports', 'architecture'
  description TEXT NOT NULL,
  examples TEXT,                  -- JSON array of examples
  source TEXT NOT NULL,           -- 'auto-detected', 'config', 'feedback'
  active INTEGER DEFAULT 1
);
```

**What this enables:**
- Track which comments get thumbs-up vs thumbs-down reactions
- Identify false-positive patterns per repo (e.g., "this repo always uses `any` type intentionally")
- Build per-repo convention summaries that enrich future review prompts
- Measure address rate (% of comments that were useful) over time

**Confidence: HIGH** -- Same storage technology already proven in the codebase.

---

### 2. Feedback Ingestion: GitHub Webhook Events (already supported)

| Attribute | Value |
|-----------|-------|
| Package | `@octokit/webhooks-types` (already installed) |
| New events | `pull_request_review_comment` reactions, issue resolution |

**No new dependencies needed.** The webhook infrastructure (Hono route, signature verification, event router) already handles multiple event types. Adding handlers for reaction events on review comments requires only:

1. Register new event types in the router
2. Correlate reaction events to existing `review_issues` records by `comment_id`
3. Insert feedback rows

GitHub sends `pull_request_review_comment` events when comments are created/edited/deleted. To track reactions (thumbs up/down), Kodiai can periodically check via the existing Octokit REST client, or listen for `issue_comment` reaction events if the webhook is configured for them.

**Confidence: HIGH** -- Webhook infrastructure already exists and is extensible.

---

### 3. Structured Review Output: Zod v4 Response Schemas (already installed)

| Attribute | Value |
|-----------|-------|
| Package | `zod` ^4.3.6 (already installed) |
| Purpose | Parse structured review output from Claude for metadata extraction |

**Why structured output matters for v0.4:**

Currently, Claude's review output goes directly to GitHub via MCP tools (inline comments, summary comments). Kodiai has no structured understanding of what was reported -- it only knows `published: true/false`.

For intelligent review, Kodiai needs to understand what Claude found:
- How many issues, at what severity levels
- Which categories (security, logic, performance, etc.)
- Confidence scores per issue
- Whether suggestions were included

**Approach:** Modify the review prompt to instruct Claude to call a new MCP tool (`report_review_findings`) with structured JSON matching a Zod schema BEFORE posting comments. This tool captures the structured data, stores it in `review_issues`, then Claude proceeds to post the GitHub comments as before.

```typescript
// New Zod schema for structured review findings
const reviewFindingSchema = z.object({
  filePath: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  severity: z.enum(["critical", "major", "medium", "minor"]),
  category: z.enum([
    "security", "logic", "performance",
    "maintainability", "error-handling", "concurrency"
  ]),
  confidence: z.number().min(0).max(100),
  title: z.string(),
  hasSuggestion: z.boolean(),
});

const reviewFindingsSchema = z.object({
  findings: z.array(reviewFindingSchema),
  reviewMode: z.enum(["strict", "standard", "lenient"]),
});
```

**Confidence: HIGH** -- MCP tool pattern already proven in the codebase (inline-review-server, comment-server).

---

### 4. Config Schema Extensions: Zod v4 (already installed)

| Attribute | Value |
|-----------|-------|
| Package | `zod` ^4.3.6 (already installed) |
| Changes | Extend `reviewSchema` in `src/execution/config.ts` |

**New `.kodiai.yml` review configuration fields:**

```yaml
review:
  # Existing fields preserved...
  enabled: true
  autoApprove: true
  prompt: "custom instructions"
  skipAuthors: []
  skipPaths: []
  triggers:
    onOpened: true
    onReadyForReview: true
    onReviewRequested: true

  # NEW v0.4 fields:
  mode: standard          # 'strict' | 'standard' | 'lenient'
  confidenceThreshold: 80 # 0-100, only report issues >= this confidence
  severityFilter: minor   # minimum severity to report: 'critical' | 'major' | 'medium' | 'minor'
  categories:             # which categories to check (all by default)
    - security
    - logic
    - performance
    - maintainability
    - error-handling
    - concurrency
  conventions:            # explicit repo conventions for Claude to respect
    - "We use Result types instead of throwing exceptions"
    - "All database queries go through the repository pattern"
    - "Test files use vitest, not jest"
  suppressPatterns:       # patterns to never flag (learned or explicit)
    - "any type usage in test files"
    - "console.log in scripts/"
```

**Zod schema extension:**

```typescript
const reviewModeSchema = z.enum(["strict", "standard", "lenient"]).default("standard");
const severitySchema = z.enum(["critical", "major", "medium", "minor"]).default("minor");
const categorySchema = z.enum([
  "security", "logic", "performance",
  "maintainability", "error-handling", "concurrency"
]);

// Extend existing reviewSchema
const reviewSchema = z.object({
  // ...existing fields...
  mode: reviewModeSchema,
  confidenceThreshold: z.number().min(0).max(100).default(80),
  severityFilter: severitySchema,
  categories: z.array(categorySchema).default([
    "security", "logic", "performance",
    "maintainability", "error-handling", "concurrency"
  ]),
  conventions: z.array(z.string()).default([]),
  suppressPatterns: z.array(z.string()).default([]),
}).default({/* defaults */});
```

The forward-compatible config parsing (pass-1 full parse, pass-2 section fallback) already handles unknown fields gracefully. New fields with defaults will not break existing `.kodiai.yml` files.

**Confidence: HIGH** -- Schema extension follows the exact pattern already used for v0.3 additions.

---

### 5. Convention Detection: Prompt-Based Analysis (no new libraries)

| Attribute | Value |
|-----------|-------|
| Package | None new |
| Mechanism | Pre-review analysis prompt sent to Claude Code |

**Why NOT tree-sitter or ESLint-as-library:**

| Temptation | Why Avoid |
|------------|-----------|
| tree-sitter (^0.25.0) + tree-sitter-typescript (^0.23.2) | Native Node addon with Bun compatibility caveats (macOS requires custom builds). Claude Code can already read and understand code structure natively via Read/Grep/Glob tools. Adding 2 native deps for something the LLM already does is wrong. |
| eslint (as library) | Massive dependency tree (~100+ transitive deps). ESLint finds style issues, which is exactly what we want to AVOID flagging. Claude should focus on bugs and logic. |
| semgrep/CodeQL integration | External tools requiring separate installation. Adds deployment complexity. Useful for dedicated SAST but overkill for PR review feedback. |

**What to do instead:**

Build a "convention analysis" prompt that runs once per repo (cached in `repo_conventions` table) and generates a conventions summary. This prompt instructs Claude to:

1. Read key config files (tsconfig.json, .eslintrc, package.json scripts)
2. Sample a few representative source files
3. Identify patterns: error handling style, import conventions, testing framework, naming patterns
4. Output structured JSON matching a Zod schema

Store the result in `repo_conventions` and inject it into future review prompts as context. Re-analyze periodically (e.g., weekly) or when config changes.

**Confidence: MEDIUM** -- This is a novel pattern. The prompt approach is sound in principle but needs validation during implementation to verify Claude produces consistent, useful convention summaries.

---

### 6. Review Prompt Enhancement: Template System (no new libraries)

| Attribute | Value |
|-----------|-------|
| Package | None new |
| Changes | Refactor `buildReviewPrompt()` in `src/execution/review-prompt.ts` |

**Current state:** `buildReviewPrompt()` builds a single monolithic prompt string with hardcoded sections (what to look for, how to report, rules, summary format).

**v0.4 changes:**
- Make the prompt a composable template with sections that vary by review mode
- Inject repo conventions from the database
- Inject suppress patterns to reduce false positives
- Add the structured findings MCP tool instruction
- Add confidence scoring instructions (score each issue 0-100)
- Vary strictness by mode:
  - **strict**: Report all concerns including style, lower confidence threshold
  - **standard**: Focus on correctness and safety (current behavior)
  - **lenient**: Only critical/major issues, higher confidence threshold

This requires no new libraries. The existing string-building pattern in `buildReviewPrompt()` already uses array concatenation (`lines.push(...)`) which is easily extended with conditional sections.

**Confidence: HIGH** -- Direct extension of existing code pattern.

---

## What NOT to Add for v0.4

| Temptation | Why Avoid |
|------------|-----------|
| **tree-sitter / tree-sitter-typescript** | Native addon with Bun compatibility caveats. Claude Code already understands code structure natively. Adds complexity for zero incremental capability. |
| **eslint (as library)** | ~100+ transitive deps. Catches style issues, which are explicitly what we want to NOT flag. |
| **Voyage AI embeddings (`voyageai` ^0.1.0)** | Embedding-based feedback clustering is the FUTURE path (demonstrated by Greptile's 19% to 55% address-rate improvement). But it requires: API key management, external API calls per review, vector similarity search infrastructure. Too much scope for v0.4. Flag for v0.5+. |
| **sqlite-vec (^0.1.7-alpha.2)** | Vector search extension for SQLite. Pre-v1, alpha quality. Would be needed for embedding-based feedback matching. Defer to v0.5+ alongside Voyage AI. macOS requires custom SQLite build with loadExtension. |
| **ML/classification libraries** | Severity classification is done by Claude in the prompt. Adding sklearn-js or custom classifiers creates a parallel decision system that would conflict with Claude's judgment. |
| **OpenAI API (for embeddings)** | Would add a second AI provider dependency. If embeddings are needed later, Voyage AI is Anthropic's recommended partner. |
| **Drizzle / Kysely ORM** | Still ~10 tables total across all v0.4 needs. Raw SQL with prepared statements remains clearer and has zero overhead. |
| **Redis / external cache** | Convention caching fits perfectly in SQLite. No need for external infrastructure. |
| **Dedicated SAST tools (Semgrep, Snyk)** | External tools requiring separate installation. Claude handles security review adequately for PR-level analysis. Dedicated SAST belongs in CI pipelines, not in the review agent. |

---

## Future Stack (v0.5+ -- Flagged for Later Research)

These additions were identified as high-value but out of scope for v0.4:

| Technology | Version (current) | Purpose | When |
|------------|-------------------|---------|------|
| `voyageai` | ^0.1.0 | Text embeddings for feedback clustering | v0.5 -- when enough feedback data exists to cluster |
| `sqlite-vec` | ^0.1.7-alpha.2 | Vector similarity search in SQLite | v0.5 -- companion to Voyage embeddings |
| Voyage `voyage-code-3` model | N/A | Code-specific embeddings (better than general text) | v0.5 -- specialized for code review comments |

**Why defer:** Embedding-based feedback clustering requires (1) a corpus of feedback data to cluster against, and (2) API integration with an embedding provider. v0.4 must first build the feedback collection infrastructure. Once v0.4 ships and feedback accumulates over weeks/months, v0.5 can add the clustering layer.

---

## Integration Points

### How Feedback Storage Integrates with Existing Code

The existing `createTelemetryStore()` factory in `src/telemetry/store.ts` creates a `Database` instance and returns an interface with `record()`, `purgeOlderThan()`, `checkpoint()`, `close()`. The v0.4 feedback store should follow the same pattern:

1. **Same database file** (`./data/kodiai-telemetry.db`) -- add tables alongside `executions`
2. **Same factory pattern** -- `createFeedbackStore({ db, logger })` takes the existing Database instance
3. **Same fire-and-forget pattern** -- feedback writes are non-blocking, wrapped in try/catch
4. **Same DI injection** -- pass the store to handlers that need it

### How Config Extensions Integrate

The existing two-pass config parsing (full schema parse, then section-by-section fallback) already handles schema evolution gracefully. New fields in `reviewSchema` with `.default()` values will:

1. Be ignored by existing `.kodiai.yml` files (defaults apply)
2. Parse correctly when users add them
3. Produce clear warnings on invalid values (section fallback catches this)

### How the Structured Review MCP Tool Integrates

New MCP server following the exact pattern of `createInlineReviewServer()`:

1. Created in `src/execution/mcp/review-findings-server.ts`
2. Registered in `buildMcpServers()` in `src/execution/mcp/index.ts`
3. Tool name added to `buildAllowedMcpTools()` output
4. Called by Claude during review BEFORE posting inline comments
5. Stores findings in `review_issues` table

### How Convention Context Integrates with Review Prompts

1. Before building the review prompt, query `repo_conventions` for the target repo
2. If conventions exist and are recent (< 7 days), inject them into the prompt
3. If missing or stale, optionally trigger a background convention analysis job
4. Convention strings are injected into a new "## Repository Conventions" section in the prompt

---

## Version Compatibility Matrix (v0.4 additions)

| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| `bun:sqlite` new tables | Existing `./data/kodiai-telemetry.db` | Same WAL-mode database, same concurrency model |
| Zod v4 schema extensions | Existing `repoConfigSchema` | `.extend()` or direct field additions. Forward-compatible parsing handles gracefully. |
| New MCP server | Existing `buildMcpServers()` pattern | Same `createSdkMcpServer()` + `tool()` API from Agent SDK |
| New webhook event handlers | Existing `eventRouter.register()` | Same registration pattern, same job queue integration |
| Pino structured logging | Existing logger setup | Same `createChildLogger()` with custom fields |

---

## Installation

```bash
# v0.4 requires NO new npm package installations.
# All capabilities use existing dependencies or built-in Bun modules.

# Verify existing dependencies still resolve:
bun install

# Verify bun:sqlite still works (should print "ok"):
bun -e "import { Database } from 'bun:sqlite'; const db = new Database(':memory:'); db.run('CREATE TABLE test (id INTEGER)'); console.log('ok')"
```

**Net new npm dependencies for v0.4: ZERO.**

This is deliberate. The intelligent review system is built on:
- Better prompts (enriched context, conventions, severity taxonomy)
- Feedback data collection (new SQLite tables, webhook events)
- Config-driven behavior (new Zod schema fields)
- Structured Claude output (new MCP tool)

All of these use infrastructure and libraries already in the codebase.

---

## Summary of Stack Decisions

| v0.4 Need | Decision | Rationale |
|-----------|----------|-----------|
| Feedback storage | Extend existing `bun:sqlite` database | Zero new deps, proven pattern, same WAL concurrency |
| Feedback ingestion | Extend existing webhook handlers | Event router already supports registration of new event types |
| Structured review output | New MCP tool with Zod schema | Same pattern as inline-review-server, captures metadata before GitHub publish |
| Config extensions | Extend existing Zod `reviewSchema` | Forward-compatible parsing already handles new fields gracefully |
| Convention detection | Prompt-based analysis via Claude Code | Claude already has Read/Grep/Glob tools. No AST parser needed. |
| Review prompt enhancement | Refactor `buildReviewPrompt()` template | Composable sections, mode-based strictness, convention injection |
| Severity classification | Claude-driven in prompt | Prompt instructs Claude to score each issue 0-100 and classify severity |
| Pattern detection | Claude-driven in prompt | Claude reads code natively; tree-sitter/ESLint would duplicate this |
| Embedding-based clustering | DEFERRED to v0.5+ | Needs feedback corpus first. Will use Voyage AI + sqlite-vec when ready. |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Code analysis | Claude Code (prompt-driven) | tree-sitter + custom AST rules | Native addon complexity, Bun caveats, duplicates LLM capability |
| Static analysis | None (Claude handles it) | ESLint-as-library | 100+ transitive deps, catches style not bugs, anti-goal for review |
| Feedback storage | bun:sqlite (existing) | PostgreSQL | External infrastructure, overkill for single-replica private use |
| Feedback storage | bun:sqlite (existing) | JSON files | No query capability, no concurrent access safety |
| Embeddings | Deferred (v0.5+) | Voyage AI now | Need feedback corpus first; premature to add API dependency |
| Vector search | Deferred (v0.5+) | sqlite-vec now | Alpha quality (0.1.7-alpha.2), macOS loadExtension issues |
| Severity scoring | Claude prompt instructions | Custom ML classifier | Would conflict with Claude's judgment, adds training/maintenance burden |
| Convention detection | Claude prompt analysis | tree-sitter pattern matching | Claude can understand conventions semantically, not just syntactically |

---

## Sources

- [Greptile: AI Code Review Bubble](https://www.greptile.com/blog/ai-code-review-bubble) -- Embedding clustering improved address rate from 19% to 55%; prompting alone was ineffective (MEDIUM confidence, single source)
- [Claude Code code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md) -- Multi-agent architecture, confidence scoring >=80 threshold (HIGH confidence, official source)
- [Benchmarking LLM-based Code Review (arxiv)](https://arxiv.org/html/2509.01494v1) -- Top ACR achieves 19% F1; false positives are the primary bottleneck (MEDIUM confidence, academic source)
- [Qodo: Best AI Code Review Tools 2026](https://www.qodo.ai/blog/best-ai-code-review-tools-2026/) -- Context-aware analysis, learning systems, feedback loops (LOW confidence, marketing content)
- [CodeRabbit vs Greptile comparison](https://www.getpanto.ai/blog/coderabbit-vs-greptile-ai-code-review-tools-compared) -- Architecture differences, learning approaches (LOW confidence, third-party comparison)
- [Bun SQLite documentation](https://bun.com/docs/runtime/sqlite) -- loadExtension API, WAL mode, Database class (HIGH confidence, official docs)
- [sqlite-vec documentation](https://alexgarcia.xyz/sqlite-vec/js.html) -- Bun compatibility via loadExtension, macOS caveats (MEDIUM confidence, maintainer docs)
- [Voyage AI TypeScript SDK](https://github.com/voyage-ai/typescript-sdk) -- voyageai ^0.1.0, voyage-code-3 model for code embeddings (MEDIUM confidence, official repo)
- [Anthropic Embeddings docs](https://docs.claude.com/en/docs/build-with-claude/embeddings) -- Voyage AI as recommended partner (HIGH confidence, official docs)
- [tree-sitter npm](https://www.npmjs.com/package/tree-sitter) -- v0.25.0, Bun build --compile support since v0.24.4 (MEDIUM confidence, npm registry)
- [Zod schema versioning](https://www.jcore.io/articles/schema-versioning-with-zod) -- Extension patterns, discriminated unions (MEDIUM confidence)
- Codebase review: `package.json`, `src/execution/config.ts`, `src/execution/review-prompt.ts`, `src/execution/executor.ts`, `src/execution/mcp/inline-review-server.ts`, `src/telemetry/store.ts`, `src/handlers/review.ts` (HIGH confidence, direct code analysis)
- npm registry version checks: `sqlite-vec@0.1.7-alpha.2`, `voyageai@0.1.0`, `tree-sitter@0.25.0`, `tree-sitter-typescript@0.23.2`, `zod@4.3.6` (HIGH confidence, verified 2026-02-11)

---
*Stack research for: Kodiai v0.4 Intelligent Review System*
*Researched: 2026-02-11*
