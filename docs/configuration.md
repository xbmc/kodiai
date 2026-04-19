# Configuration Reference

This document is the complete reference for `.kodiai.yml` — the per-repository configuration file that controls Kodiai's behavior. Place this file in the root of your repository.

For environment variables and application-level config (API keys, database URLs, etc.), see [`.env.example`](../.env.example).

## Quick Start Example

```yaml
# .kodiai.yml — common configuration
model: claude-sonnet-4-5-20250929
maxTurns: 25
timeoutSeconds: 600

review:
  enabled: true
  autoApprove: true
  triggers:
    onOpened: true
    onReadyForReview: true
    onReviewRequested: true
    onSynchronize: true
  maxComments: 7
  severity:
    minLevel: medium
  focusAreas:
    - security
    - correctness
  skipPaths:
    - "*.lock"
    - "dist/**"

mention:
  enabled: true

write:
  enabled: false

knowledge:
  retrieval:
    enabled: true
    topK: 5

telemetry:
  enabled: true
  costWarningUsd: 5.00
```

## Config Loading Behavior

When Kodiai loads `.kodiai.yml`, it uses a two-pass `safeParse` strategy:

1. **Pass 1 (full schema):** The entire file is parsed against the complete Zod schema. If it validates, the config is used as-is.
2. **Pass 2 (per-section fallback):** If full-schema validation fails, each top-level section is parsed independently. Sections that fail validation fall back to their defaults, and a warning is emitted per failed section. This ensures a typo in one section doesn't break the entire config.

If no `.kodiai.yml` exists, all defaults apply.

---

## Top-Level Options

These fields sit at the root of `.kodiai.yml`, outside any section.

### `model`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `"claude-sonnet-4-5-20250929"` |

The primary LLM model used for tasks. This is the baseline model unless overridden by `models`, `defaultModel`, or task-specific routing.

### `maxTurns`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `1–100` |
| **Default** | `25` |

Maximum number of agentic turns per execution. Limits how many LLM round-trips a single task can perform.

### `timeoutSeconds`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `30–1800` |
| **Default** | `600` |

Hard timeout in seconds for a single task execution. The `timeout` section below controls dynamic scaling behavior within this limit.

### `systemPromptAppend`

| | |
|---|---|
| **Type** | `string` |
| **Default** | *(none)* |

Optional text appended to the system prompt for all tasks. Use this to inject repository-specific instructions (e.g., coding conventions, domain context).

### `models`

| | |
|---|---|
| **Type** | `Record<string, string>` |
| **Default** | `{}` |

Per-task-type model overrides. Keys are task type identifiers (e.g., `"review.full"`, `"mention.reply"`), values are model names.

```yaml
models:
  review.full: claude-sonnet-4-5-20250929
  mention.reply: gpt-4o-mini
```

### `defaultModel`

| | |
|---|---|
| **Type** | `string` |
| **Default** | *(none)* |

Global default model for task routing. When set, this overrides `model` for task router decisions.

### `defaultFallbackModel`

| | |
|---|---|
| **Type** | `string` |
| **Default** | *(none)* |

Fallback model used when the primary model fails (e.g., rate limits, unavailability). If unset, failures are not retried with a different model.

---

## `review`

Controls PR review behavior. This is the largest configuration section.

| | |
|---|---|
| **Default** | Enabled with all sub-defaults below |

### `review.enabled`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Master switch for PR reviews. Set to `false` to disable all automated reviews.

### `review.triggers`

Controls which GitHub webhook events trigger a review.

| Field | Type | Default | Description |
|---|---|---|---|
| `onOpened` | `boolean` | `true` | Review when PR is opened |
| `onReadyForReview` | `boolean` | `true` | Review when PR moves from draft to ready |
| `onReviewRequested` | `boolean` | `true` | Review when Kodiai is explicitly requested as a reviewer |
| `onSynchronize` | `boolean` | `false` | Review on new pushes to the PR branch |

```yaml
review:
  triggers:
    onSynchronize: true
```

Use the nested `review.triggers.onSynchronize` shape. Legacy `review.onSynchronize` is ignored at runtime and produces a config warning so intent drift fails loudly.

### `review.autoApprove`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

If `true`, Kodiai submits an approving review when no critical/major findings exist. Set to `false` to always submit as a comment-only review.

### `review.prompt`

| | |
|---|---|
| **Type** | `string` |
| **Default** | *(none)* |

Custom prompt text injected into the review context. Use for repo-specific review instructions.

### `review.skipAuthors`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` |

List of GitHub usernames whose PRs should be skipped entirely. Useful for bot accounts.

### `review.skipPaths`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` |

Glob patterns for file paths to exclude from review. Files matching any pattern are ignored.

```yaml
review:
  skipPaths:
    - "*.lock"
    - "dist/**"
    - "generated/**"
```

### `review.mode`

| | |
|---|---|
| **Type** | `"standard" \| "enhanced"` |
| **Default** | `"standard"` |

Review output mode. `standard` produces normal review comments. `enhanced` adds structured YAML metadata per comment for machine consumption.

### `review.severity`

Controls minimum severity for reported findings.

| Field | Type | Default | Description |
|---|---|---|---|
| `minLevel` | `"critical" \| "major" \| "medium" \| "minor"` | `"minor"` | Only report findings at or above this level |

```yaml
review:
  severity:
    minLevel: medium  # Skip minor findings
```

### `review.focusAreas`

| | |
|---|---|
| **Type** | `Array<"security" \| "correctness" \| "performance" \| "style" \| "documentation">` |
| **Default** | `[]` (all categories) |

Concentrate review on specific categories. Empty array means all categories are reviewed.

### `review.ignoredAreas`

| | |
|---|---|
| **Type** | `Array<"security" \| "correctness" \| "performance" \| "style" \| "documentation">` |
| **Default** | `[]` |

Categories to skip unless the finding is CRITICAL severity. Useful for suppressing style comments while still catching critical style violations.

### `review.maxComments`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `1–25` |
| **Default** | `7` |

Maximum number of inline comments per review. Findings are prioritized so the most important ones are shown first.

### `review.suppressions`

| | |
|---|---|
| **Type** | `Array<string \| SuppressionPattern>` |
| **Default** | `[]` |

Patterns to suppress specific findings. Can be simple strings (matched against finding text) or structured objects:

```yaml
review:
  suppressions:
    - "TODO comment"              # Simple string match
    - pattern: "missing docs"     # Structured suppression
      severity: [minor, medium]
      category: [documentation]
      paths: ["src/internal/**"]
```

**SuppressionPattern fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `pattern` | `string` | Yes | Text pattern to match against finding |
| `severity` | `Array<"critical" \| "major" \| "medium" \| "minor">` | No | Only suppress at these severity levels |
| `category` | `Array<"security" \| "correctness" \| "performance" \| "style" \| "documentation">` | No | Only suppress in these categories |
| `paths` | `string[]` | No | Only suppress for files matching these glob patterns |

### `review.minConfidence`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `0–100` |
| **Default** | `0` |

Minimum confidence score for a finding to be reported. Findings below this threshold are dropped.

### `review.prioritization`

Weights for finding prioritization scoring. Values are normalized at runtime.

| Field | Type | Default | Description |
|---|---|---|---|
| `severity` | `number` (0–1) | `0.45` | Weight given to finding severity |
| `fileRisk` | `number` (0–1) | `0.30` | Weight given to file risk score |
| `category` | `number` (0–1) | `0.15` | Weight given to finding category |
| `recurrence` | `number` (0–1) | `0.10` | Weight given to recurrence patterns |

### `review.pathInstructions`

| | |
|---|---|
| **Type** | `Array<PathInstruction>` |
| **Default** | `[]` |

Path-specific review instructions. Each entry maps a glob pattern (or array of patterns) to custom instructions applied when reviewing matching files.

```yaml
review:
  pathInstructions:
    - path: "src/api/**"
      instructions: "Check for proper authentication and input validation"
    - path: ["*.test.ts", "*.spec.ts"]
      instructions: "Focus on test coverage and edge cases"
```

| Field | Type | Description |
|---|---|---|
| `path` | `string \| string[]` | Glob pattern(s) to match |
| `instructions` | `string` | Custom review instructions for matching files |

### `review.profile`

| | |
|---|---|
| **Type** | `"strict" \| "balanced" \| "minimal"` |
| **Default** | *(none)* |

Review profile preset. When set, adjusts multiple review parameters at once to match a predefined strictness level.

### `review.outputLanguage`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `"en"` |

Language for review prose output. Accepts ISO language codes or full language names (e.g., `"ja"`, `"Japanese"`, `"es"`).

### `review.fileCategories`

| | |
|---|---|
| **Type** | `object` |
| **Default** | *(none)* |

Custom file category mappings. Override which glob patterns map to each category for risk scoring and review behavior.

| Field | Type | Description |
|---|---|---|
| `source` | `string[]` | Patterns for source code files |
| `test` | `string[]` | Patterns for test files |
| `config` | `string[]` | Patterns for configuration files |
| `docs` | `string[]` | Patterns for documentation files |
| `infra` | `string[]` | Patterns for infrastructure files |

---

## `mention`

Controls `@kodiai` mention behavior in PR comments and issues.

| | |
|---|---|
| **Default** | Enabled with all sub-defaults below |

### `mention.enabled`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Master switch for mention responses. Set to `false` to ignore all @kodiai mentions.

### `mention.acceptClaudeAlias`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

If `true`, also responds to `@claude` mentions as an alias for `@kodiai`.

### `mention.allowedUsers`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` (all users allowed) |

Restrict mention responses to these GitHub usernames. Empty array means any user can trigger mentions.

### `mention.prompt`

| | |
|---|---|
| **Type** | `string` |
| **Default** | *(none)* |

Custom prompt text injected into mention response context.

### `mention.conversation`

Controls conversation limits for multi-turn mention interactions.

| Field | Type | Default | Description |
|---|---|---|---|
| `maxTurnsPerPr` | `number` (1–50) | `10` | Maximum conversation turns per PR |
| `contextBudgetChars` | `number` (1000–50000) | `8000` | Maximum characters of conversation context |

---

## `write`

Controls write mode — the ability for Kodiai to create branches, commit code, and push changes when triggered by mentions. **Deny-by-default.** Enabling write mode does not affect review-only behavior.

| | |
|---|---|
| **Default** | Disabled |

### `write.enabled`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

Master switch for write mode. Must be explicitly enabled.

### `write.allowPaths`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` |

Glob patterns for paths Kodiai is allowed to modify. If set, every changed path must match at least one pattern. Empty array means no path restrictions (all paths allowed when write is enabled).

### `write.denyPaths`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | See below |

Glob patterns for paths Kodiai must never modify. **Deny always wins over allow.**

Default deny list:
```
.github/
.git/
.planning/
.kodiai.yml
.env
.env.*
**/*.pem
**/*.key
**/*.p12
**/*.pfx
**/*credentials*
**/*secret*
```

### `write.minIntervalSeconds`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `0–86400` |
| **Default** | `0` |

Basic rate limit for write-mode requests, in seconds between allowed operations. `0` means no rate limit.

### `write.secretScan`

Pre-commit secret scanning configuration.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Scan for secrets before committing changes |

---

## `knowledge`

Controls the knowledge system — learning from past reviews, embedding generation, and context-aware retrieval. See [knowledge-system.md](knowledge-system.md) for detailed architecture.

| | |
|---|---|
| **Default** | Enabled with repository-scoped knowledge |

### `knowledge.shareGlobal`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

*Deprecated — use `knowledge.sharing.enabled` instead.*

When `true`, knowledge writes are shared at the owner (organization) level instead of being repository-scoped.

### `knowledge.sharing`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Enable owner-level knowledge sharing across repositories |

### `knowledge.embeddings`

Controls embedding generation for the knowledge system.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable embedding generation |
| `model` | `string` | `"voyage-code-3"` | Embedding model to use |
| `dimensions` | `number` (256–2048) | `1024` | Embedding vector dimensions |

### `knowledge.retrieval`

Controls context-aware retrieval during reviews.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable knowledge retrieval |
| `topK` | `number` (1–20) | `5` | Number of similar past findings to retrieve |
| `distanceThreshold` | `number` (0–2) | `0.3` | Maximum cosine distance for similarity matching |
| `adaptive` | `boolean` | `true` | Enable adaptive retrieval (adjusts parameters based on context) |
| `maxContextChars` | `number` (0–5000) | `2000` | Maximum characters of retrieved context to include |

### `knowledge.retrieval.hunkEmbedding`

Controls hunk-level embedding of PR diffs for fine-grained knowledge retrieval.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable hunk-level diff embedding |
| `maxHunksPerPr` | `number` (1–1000) | `100` | Maximum hunks to embed per PR |
| `minChangedLines` | `number` (1–50) | `3` | Minimum changed lines for a hunk to be embedded |
| `excludePatterns` | `string[]` | See below | Glob patterns for files to exclude from hunk embedding |

Default `excludePatterns`:
```
*.lock
vendor/**
generated/**
*.generated.*
*.min.js
*.min.css
dist/**
build/**
node_modules/**
```

---

## `telemetry`

Controls execution telemetry and cost tracking.

| | |
|---|---|
| **Default** | Enabled, no cost warning |

### `telemetry.enabled`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Master switch for telemetry recording. Set to `false` to disable telemetry for this repository.

### `telemetry.costWarningUsd`

| | |
|---|---|
| **Type** | `number` |
| **Minimum** | `0` |
| **Default** | `0` |

USD threshold for cost warnings. When execution cost exceeds this value, a warning is emitted. `0` disables cost warnings.

---

## `languageRules`

Controls language-specific review behavior, including severity floors and tooling-aware suppression.

| | |
|---|---|
| **Default** | No overrides, built-in floors active |

### `languageRules.severityFloors`

| | |
|---|---|
| **Type** | `Array<SeverityFloorOverride>` |
| **Default** | `[]` |

Override the minimum severity for findings matching specific patterns, optionally scoped to a language.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `pattern` | `string` | Yes | — | Text pattern to match against findings |
| `language` | `string` | No | *(all)* | Restrict to this language |
| `minSeverity` | `"critical" \| "major" \| "medium" \| "minor"` | Yes | — | Minimum severity for matching findings |
| `skipTestFiles` | `boolean` | No | `true` | Skip this rule for test files |

### `languageRules.toolingOverrides`

| | |
|---|---|
| **Type** | `Array<ToolingOverride>` |
| **Default** | `[]` |

Suppress formatting and import-order findings for languages that have dedicated tooling (e.g., Prettier, ESLint).

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `language` | `string` | Yes | — | Language to apply override to |
| `suppressFormatting` | `boolean` | No | `true` | Suppress formatting findings |
| `suppressImportOrder` | `boolean` | No | `true` | Suppress import order findings |
| `configFiles` | `string[]` | No | *(none)* | Tooling config files that indicate this override applies |

### `languageRules.disableBuiltinFloors`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

If `true`, disables Kodiai's built-in severity floor rules. Only your custom `severityFloors` will apply.

---

## `largePR`

Controls triage behavior for large pull requests. When a PR exceeds the file threshold, Kodiai scores files by risk and reviews a subset at full depth.

| | |
|---|---|
| **Default** | Triggered at 50 files |

### `largePR.fileThreshold`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `10–1000` |
| **Default** | `50` |

Number of changed files that triggers large PR triage mode.

### `largePR.fullReviewCount`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `5–200` |
| **Default** | `30` |

Number of highest-risk files to review at full depth.

### `largePR.abbreviatedCount`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `0–200` |
| **Default** | `20` |

Number of files to review at abbreviated depth (critical/major findings only). These are the next-highest-risk files after the full review set.

**Truthfulness note:** large-PR triage already bounds effective review scope. When a GitHub-visible review summary is published for a bounded review, Kodiai discloses the requested profile versus the effective large-PR coverage instead of implying exhaustive file-by-file review.

### `largePR.riskWeights`

Weights for file risk scoring in large PR triage. Values are normalized at runtime so they need not sum to exactly 1.0.

| Field | Type | Default | Description |
|---|---|---|---|
| `linesChanged` | `number` (0–1) | `0.30` | Weight for number of lines changed |
| `pathRisk` | `number` (0–1) | `0.30` | Weight for path-based risk (e.g., critical directories) |
| `fileCategory` | `number` (0–1) | `0.20` | Weight for file category (source vs test vs config) |
| `languageRisk` | `number` (0–1) | `0.10` | Weight for language-specific risk |
| `fileExtension` | `number` (0–1) | `0.10` | Weight for file extension risk |

---

## `feedback`

Controls feedback-driven auto-suppression. When users consistently 👎 a type of finding across multiple PRs, Kodiai can automatically suppress it.

| | |
|---|---|
| **Default** | Disabled |

### `feedback.autoSuppress`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Enable feedback-driven auto-suppression |

### `feedback.autoSuppress.thresholds`

Thresholds that must all be met before a finding pattern is auto-suppressed.

| Field | Type | Range | Default | Description |
|---|---|---|---|---|
| `minThumbsDown` | `number` | 1–50 | `3` | Minimum total 👎 reactions |
| `minDistinctReactors` | `number` | 1–50 | `3` | Minimum distinct users who reacted 👎 |
| `minDistinctPRs` | `number` | 1–50 | `2` | Minimum distinct PRs with 👎 on this pattern |

---

## `timeout`

Controls dynamic timeout behavior within the `timeoutSeconds` hard limit.

| | |
|---|---|
| **Default** | Both features enabled |

### `timeout.dynamicScaling`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Enable dynamic timeout scaling based on PR size and complexity.

### `timeout.autoReduceScope`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Enable automatic scope reduction when approaching timeout. Kodiai will reduce review depth to ensure a result is returned within the time limit.

When this triggers, the GitHub-visible summary and Review Details disclose the requested profile versus the effective profile and bounded coverage. If reduction is skipped because the review profile was set explicitly, Review Details records that skip instead of implying the review was exhaustive.

---

## `triage`

Controls issue triage behavior — automatic labeling, duplicate detection, and troubleshooting suggestions for new issues.

| | |
|---|---|
| **Default** | Disabled (opt-in) |

### `triage.enabled`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

Master switch for triage tools. Must be explicitly enabled.

### `triage.autoTriageOnOpen`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |

Automatically triage new issues on `issues.opened` webhook events.

### `triage.duplicateThreshold`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `0–100` |
| **Default** | `75` |

Similarity percentage cutoff for duplicate detection. `75` means 0.25 cosine distance — issues more similar than this threshold are flagged as potential duplicates.

### `triage.maxDuplicateCandidates`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `1–10` |
| **Default** | `3` |

Maximum number of duplicate candidates to show in the triage comment.

### `triage.duplicateLabel`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `"possible-duplicate"` |

Label applied to issues when duplicate candidates are found.

### `triage.label`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable automatic label application during triage |

### `triage.comment`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable triage comment posting on issues |

### `triage.labelAllowlist`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `[]` (allow all) |

Restrict which labels triage can apply. Empty array means all labels are allowed. When set, triage will only apply labels matching these patterns.

### `triage.cooldownMinutes`

| | |
|---|---|
| **Type** | `number` |
| **Range** | `0–1440` |
| **Default** | `30` |

Per-issue cooldown in minutes before re-triaging. Prevents repeated triage on rapidly-updated issues. `0` disables cooldown.

### `triage.troubleshooting`

Controls retrieval of resolved-issue guidance for troubleshooting suggestions.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Enable troubleshooting retrieval |
| `similarityThreshold` | `number` (0–1) | `0.65` | Minimum similarity for retrieving past resolutions |
| `maxResults` | `number` (1–10) | `3` | Maximum resolved issues to reference |
| `totalBudgetChars` | `number` (1000–50000) | `12000` | Maximum characters of troubleshooting context |

---

## `guardrails`

Controls epistemic guardrail strictness — how aggressively Kodiai hedges uncertain findings.

| | |
|---|---|
| **Default** | Standard strictness |

### `guardrails.strictness`

| | |
|---|---|
| **Type** | `"strict" \| "standard" \| "lenient"` |
| **Default** | `"standard"` |

- **`strict`** — More aggressive hedging; uncertain findings are more likely to be suppressed or downgraded
- **`standard`** — Balanced approach
- **`lenient`** — Less hedging; more findings reported even when confidence is lower

---

## Environment Variables

Application-level configuration (API keys, database URLs, webhook secrets, port, host) is managed through environment variables, not `.kodiai.yml`.

See [`.env.example`](../.env.example) for the complete list of supported environment variables with descriptions.
