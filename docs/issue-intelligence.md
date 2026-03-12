# Issue Intelligence

Kodiai's issue intelligence subsystem automatically triages new GitHub issues — validating template compliance, detecting duplicates via vector similarity, retrieving troubleshooting context from resolved issues, and learning detection thresholds from feedback.

> **Related docs:** [Architecture](architecture.md) · [Configuration](configuration.md#triage) · [Knowledge System](knowledge-system.md)

## Overview

When an issue is opened, the `issue-opened` handler orchestrates a pipeline:

1. **Template validation** — match issue body against repo `.github/ISSUE_TEMPLATE/*.md` files, identify missing/empty sections
2. **Duplicate detection** — embed the issue and search the issue corpus for vector-similar candidates above a configurable similarity threshold
3. **Troubleshooting retrieval** — find resolved issues (and optionally wiki pages) relevant to the new issue, assemble resolution-focused threads
4. **Comment & label** — post a triage comment with duplicate candidates and/or troubleshooting guidance, apply labels

All steps are fail-open — individual failures skip the step without blocking the rest of the pipeline.

## Component Summary

| Component | File | Purpose |
|---|---|---|
| Issue opened handler | `src/handlers/issue-opened.ts` | Webhook handler, orchestration, 4-layer idempotency |
| Triage agent | `src/triage/triage-agent.ts` | Template validation, guidance comment generation |
| Template parser | `src/triage/template-parser.ts` | Parse `.md` templates, diff issue body against template |
| Duplicate detector | `src/triage/duplicate-detector.ts` | Vector similarity search against issue corpus |
| Threshold learner | `src/triage/threshold-learner.ts` | Bayesian Beta distribution for adaptive thresholds |
| Triage comment | `src/triage/triage-comment.ts` | Comment formatting, idempotency markers |
| Troubleshooting retrieval | `src/knowledge/troubleshooting-retrieval.ts` | Hybrid search for resolved issues, wiki fallback |
| Thread assembler | `src/knowledge/thread-assembler.ts` | Budget-weighted thread assembly with tail + semantic comments |

## Template Validation

The triage agent validates issue bodies against the repo's `.github/ISSUE_TEMPLATE/*.md` files.

### Template Parsing

Each template is parsed into a `TemplateDefinition`:

- **YAML frontmatter** — extracts `name` and `labels` fields (both comma-separated and list formats)
- **Section extraction** — `##` headings become sections with `required` status (default `true`, overridden by `<!-- optional -->` comments) and `hint` text from other HTML comments

### Best-Fit Matching

When an issue arrives, headings are extracted from the issue body and compared against all templates. The template with the most case-insensitive heading matches wins (minimum 1 match required).

### Diff Against Template

Each template section is checked against the issue body:

| Status | Meaning |
|---|---|
| `present` | Heading exists and has non-placeholder content |
| `missing` | Heading not found in issue body |
| `empty` | Heading exists but content is empty or matches placeholder patterns (`N/A`, `none`, `...`, `TODO`, `TBD`, or the hint text itself) |

If any required section is `missing` or `empty`, the issue fails validation.

### Guidance Comments

For invalid issues, a friendly guidance comment lists each missing/empty required section with its hint text. A `needs-info:<template-slug>` label is recommended (checked against the repo's label allowlist).

For issues that don't match any template, a generic nudge encourages using a template.

## Duplicate Detection

Duplicate detection uses vector similarity search against the indexed issue corpus.

### Pipeline

1. Build embedding text from the new issue's title and body via `buildIssueEmbeddingText()`
2. Generate a query embedding using the configured embedding provider
3. Search the issue store by embedding similarity (`searchByEmbedding`)
4. Filter out the current issue, apply the similarity threshold, and take the top `maxCandidates`

### Similarity Threshold

The default threshold is `75` (percent), meaning issues with ≥75% cosine similarity are flagged. This is configurable via [`triage.duplicateThreshold`](configuration.md#triageduplicatethreshold).

The effective threshold may differ from the configured value when the threshold learner has accumulated enough observations — see [Threshold Learning](#threshold-learning) below.

### Comment Format

Duplicate candidates are presented as a markdown table sorted by: closed candidates first, then by similarity descending.

```
Possible duplicates detected:

| Issue | Title | Similarity | Status |
|-------|-------|------------|--------|
| #42   | Login fails on Safari | 89% | closed |
| #38   | Auth redirect broken  | 78% | open   |

All matches are closed issues -- the problem may already be resolved.
```

Each comment includes an HTML marker (`<!-- kodiai:triage:repo:issueNumber -->`) used for idempotency detection.

### Fail-Open Design

If embedding generation or search fails, duplicate detection returns an empty array and logs a warning. No comment is posted, no label applied. This follows the DUPL-04 design constraint.

## Threshold Learning

The threshold learner uses a Bayesian Beta distribution to adaptively tune the duplicate detection threshold based on observed prediction accuracy.

### How It Works

1. **Observation recording** — When a duplicate prediction is confirmed or rejected (via reactions, label changes, or manual review), the outcome is classified into the confusion matrix:

   | Predicted Duplicate | Actually Duplicate | Quadrant | Effect |
   |---|---|---|---|
   | Yes | Yes | TP (True Positive) | alpha++ |
   | Yes | No | FP (False Positive) | beta++ |
   | No | Yes | FN (False Negative) | beta++ |
   | No | No | TN (True Negative) | Skipped (no signal) |

   Pure TN observations are skipped to avoid drowning the signal — they provide no information about duplicate detection tuning.

2. **Posterior computation** — The posterior mean `alpha / (alpha + beta)` estimates the probability that predictions are correct.

3. **Threshold derivation** — `raw = 100 × (1 - mean)`, clamped to `[floor, ceiling]` (default `[50, 95]`):
   - High accuracy → lower threshold → catch more duplicates
   - Low accuracy → higher threshold → be more selective

### Effective Threshold Resolution

The resolution chain for each repo:

1. Query `triage_threshold_state` for the repo
2. If no row or `sample_count < minSamples` (default 20), return the configured threshold
3. Otherwise, compute from alpha/beta and clamp to [floor, ceiling]

The threshold source (`learned` vs `config`) is logged with structured fields for observability.

### Storage

State is persisted in `triage_threshold_state` with atomic `INSERT ... ON CONFLICT` to prevent read-then-write races under concurrent delivery.

## Troubleshooting Retrieval

When a new issue arrives, troubleshooting retrieval searches for resolved issues that may help the reporter.

### Pipeline

1. **Generate query embedding** from title + body
2. **Hybrid search** — parallel vector and BM25 (full-text) search against closed issues
3. **RRF merge** — combine results via Reciprocal Rank Fusion (see [Knowledge System](knowledge-system.md))
4. **Apply similarity floor** — filter by `similarityThreshold` (default `0.65`, configurable via [`triage.troubleshooting`](configuration.md#triagetroubleshooting))
5. **Post-filter PRs** — exclude pull requests (can't verify merge status)
6. **Thread assembly** — for top matches, assemble resolution-focused threads with budget-weighted allocation
7. **Wiki fallback** — if no issue matches found, search wiki pages with dual query (original + extracted keywords)

### Thread Assembly

Each matching issue is assembled into a `TroubleshootingMatch`:

- **Body truncation** — long bodies are truncated to first paragraph + last paragraph
- **Budget distribution** — character budget is allocated proportionally by similarity (higher similarity = more budget)
- **Tail comments** (60% of remaining budget) — most recent comments, where fixes typically live
- **Semantic comments** (40% of remaining budget) — remaining comments ranked by embedding similarity to the query

### Keyword Extraction

For wiki fallback, keywords are extracted heuristically from the issue:
- Title words (>2 chars)
- Quoted strings (error messages)
- Words after error/exception/crash patterns
- PascalCase component names
- ALLCAPS acronyms

## Handler Idempotency

The `issue-opened` handler uses four layers of idempotency to prevent duplicate processing:

| Layer | Mechanism | Scope |
|---|---|---|
| **1. Delivery ID dedup** | Webhook route's `Deduplicator` | Prevents processing the same webhook delivery twice |
| **2. Atomic DB claim** | `INSERT ... ON CONFLICT` with cooldown window | Prevents re-triage within `cooldownMinutes` (default 30) |
| **3. Comment marker scan** | Scan existing comments for `kodiai:triage` HTML marker | Fallback if DB claim succeeds but comment already exists |
| **4. Per-issue cooldown** | `triage.cooldownMinutes` config | Time-based window preventing rapid re-triage |

The DB claim (Layer 2) uses a `WHERE` clause that only updates if the previous triage is older than the cooldown window, making the check atomic even under concurrent delivery.

### Handler Flow

```
issues.opened webhook
  → Load repo config (clone workspace, read .kodiai.yml)
  → Check triage.enabled AND autoTriageOnOpen
  → Layer 3: Scan comments for existing triage marker
  → Layer 2: Atomic DB claim with cooldown
  → Resolve effective threshold (learned or config)
  → Run duplicate detection
  → Post triage comment (if candidates found)
  → Apply duplicate label (fail-open)
  → Store comment GitHub ID for reaction tracking
  → Update triage state with duplicate count
```

## Configuration Reference

All triage settings live under the `triage` key in `.kodiai.yml`. See [Configuration](configuration.md#triage) for the full reference.

| Setting | Default | Description |
|---|---|---|
| `triage.enabled` | `false` | Master switch for triage |
| `triage.autoTriageOnOpen` | `false` | Auto-triage on `issues.opened` |
| `triage.duplicateThreshold` | `75` | Similarity % cutoff |
| `triage.maxDuplicateCandidates` | `3` | Max candidates in comment |
| `triage.duplicateLabel` | `"possible-duplicate"` | Label for flagged issues |
| `triage.cooldownMinutes` | `30` | Re-triage cooldown |
| `triage.troubleshooting.enabled` | `false` | Enable troubleshooting retrieval |
| `triage.troubleshooting.similarityThreshold` | `0.65` | Minimum similarity for resolved issues |
| `triage.troubleshooting.maxResults` | `3` | Max resolved issues to reference |
| `triage.troubleshooting.totalBudgetChars` | `12000` | Max chars of troubleshooting context |
