# Epistemic Guardrails

Kodiai's guardrail system prevents hallucinated claims from reaching users. Every generated response passes through a pipeline that classifies individual claims against the available context and silently omits those that require external knowledge the system cannot verify.

> **Related docs:** [Architecture](architecture.md) · [Configuration](configuration.md#guardrails) · [Knowledge System](knowledge-system.md)

## Design Principle

The epistemic principle: **Kodiai only asserts what it can ground in the provided context.** Claims about version numbers, release dates, CVEs, API behavior, or library internals that aren't present in the diff, issue, conversation, or retrieval results are silently removed rather than hedged. This eliminates the class of errors where an AI confidently states incorrect external facts.

Silent omission is preferred over visible hedging ("I'm not sure, but...") because hedged claims still influence the reader and create noise. The system is designed to fail open — if classification itself fails, the original output passes through unchanged.

## Pipeline Flow

The guardrail pipeline follows a four-stage process:

```
Extract Claims → Classify Each → Filter External → Reconstruct Output
```

### Stage 1: Extract Claims

The surface adapter splits the generated output into individual claim strings. The extraction strategy varies by surface:

- **Text surfaces** (mention, slack, troubleshoot) — sentence-level splitting via `extractClaims()`
- **PR review** — sentences extracted from each finding's title
- **Triage** — prose sentences only (table rows and HTML tags are skipped)
- **Wiki** — sentence-level splitting (MediaWiki `{{template}}` markers preserved)

### Stage 2: Classify Each Claim

Each claim is classified against the grounding context through a priority chain:

1. **Allowlist check** — general programming knowledge (null safety, SQL injection, race conditions, memory leaks, etc.) always passes as `diff-grounded`
2. **External-knowledge pattern detection** — regex patterns catch claims about:
   - CVE references (`CVE-2024-XXXX`)
   - Version numbers not present in context (`1.2.3`)
   - Release dates ("introduced in March 2024")
   - API behavior assertions ("always throws", "never returns")
   - Library behavior claims ("this library is/has/does")
   - Performance/complexity claims ("is O(n²)")
   - Compatibility claims ("compatible with version X")
3. **Diff delegation** — if diff context is available, delegates to the existing `classifyClaimHeuristic()` which checks the claim against added/removed/context lines
4. **Word overlap grounding** — for non-diff surfaces, computes word overlap between the claim and the provided context. The overlap threshold varies by strictness level
5. **Fail-open default** — if no external-knowledge signals are detected, the claim defaults to `diff-grounded` with confidence 0.5

### Stage 3: Filter External Claims

Claims classified as `external-knowledge` are removed. Claims classified as `diff-grounded` or `inferential` are kept. The removed claims are recorded in the audit record with their classification evidence.

If the kept claims fall below the adapter's `minContentThreshold` (word count), the entire response is suppressed — returning `null` instead of a stub.

### Stage 4: Reconstruct Output

The surface adapter rebuilds the output from only the kept claims, preserving structural elements:

- **Markdown headings** — orphaned headings (with no content below) are removed
- **Code blocks** — always preserved (never classified or filtered)
- **Tables and HTML** — preserved unchanged (triage adapter)
- **MediaWiki templates** — `{{template}}` markers always preserved (wiki adapter)
- **Bullet points** — preserved if their content matches kept claims (troubleshoot adapter)

## Classification Tiers

| Label | Meaning | Action |
|---|---|---|
| `diff-grounded` | Claim is directly supported by the provided context | **Keep** |
| `inferential` | Claim is a logical deduction from the provided context | **Keep** |
| `external-knowledge` | Claim asserts facts not present in any provided context | **Remove** |

## Strictness Levels

Strictness controls the word overlap threshold used to ground claims against context. A lower threshold makes it easier to match (stricter filtering of external claims):

| Level | Overlap Threshold | Behavior |
|---|---|---|
| `strict` | 0.3 (30% word overlap grounds the claim) | More claims grounded → more external claims filtered |
| `standard` | 0.5 (50% word overlap required) | Balanced |
| `lenient` | 0.7 (70% word overlap required) | Fewer claims grounded → more claims pass through |

Strictness is configured globally via [`guardrails.strictness`](configuration.md#guardrailsstrictness) and can be overridden per surface:

```yaml
guardrails:
  strictness: standard
  overrides:
    review:
      strictness: strict
```

## LLM Fallback

When the rule-based classifier produces a low-confidence result (below 0.6 ambiguity threshold), the claim can be escalated to an LLM classifier for a second opinion.

### Batched Haiku Calls

Ambiguous claims are batched (up to 10 per call) into a single Haiku prompt. The LLM receives each claim with its grounding context and returns a JSON array of classifications:

```json
[
  { "label": "diff-grounded", "confidence": 0.85, "evidence": "..." },
  { "label": "external-knowledge", "confidence": 0.92, "evidence": "..." }
]
```

The LLM classifier is optional — if not provided or if the call fails, ambiguous claims are treated as grounded (fail-open). The task type `GUARDRAIL_CLASSIFICATION` routes through the task router for model selection and cost tracking.

## General Programming Knowledge Allowlist

Certain claims are universal programming knowledge that should never be flagged as hallucination. The allowlist covers 8 categories:

| Category | Example Phrases |
|---|---|
| Null safety | null pointer, optional chaining, nullish coalescing |
| Injection | SQL injection, XSS, parameterized query |
| Concurrency | race condition, deadlock, thread safety |
| Resources | memory leak, connection pool, garbage collection |
| Bounds | buffer overflow, off-by-one, integer overflow |
| Error handling | uncaught exception, error boundary, graceful degradation |
| Typing | type safety, type mismatch, type guard |
| Code smells | dead code, magic number, cyclomatic complexity |

Matching is case-insensitive substring: if any allowlist phrase appears anywhere in the claim text, the claim passes immediately.

## Surface Adapters

Six surface adapters customize the pipeline for each response surface:

| Adapter | Surface ID | Grounding Sources | Min Content | Notes |
|---|---|---|---|---|
| **Review** | `review` | PR diffs, PR description, commit messages | 10 words | Extracts claims from finding titles; filters whole findings |
| **Mention** | `mention` | Issue body, PR description, conversation, retrieval, diffs | 15 words | Preserves code blocks; removes orphaned headings |
| **Triage** | `triage` | Issue title, issue body, label descriptions | 10 words | Skips table rows and HTML during extraction; preserves them in reconstruction |
| **Troubleshoot** | `troubleshoot` | Resolved issues (body + comments), wiki matches, current issue | 20 words | Preserves bullet point structure |
| **Slack** | `slack` | Retrieval results, repo code context, user message | 5 words | Simple sentence join reconstruction |
| **Wiki** | `wiki` | PR patch diffs (with PR numbers), wiki page content | 10 words | Preserves `{{template}}` markers and `== Heading ==` structure |

### Adapter Interface

Each adapter implements the `SurfaceAdapter<TInput, TOutput>` interface:

```typescript
type SurfaceAdapter<TInput, TOutput> = {
  surface: string;
  extractClaims(output: TOutput): string[];
  buildGroundingContext(input: TInput): GroundingContext;
  reconstructOutput(output: TOutput, keptClaims: string[]): TOutput;
  minContentThreshold: number;
};
```

The `GroundingContext` generalizes beyond diffs to support any text-based grounding:

```typescript
type GroundingContext = {
  providedContext: string[];      // Text strings to ground against
  diffContext?: DiffContext;      // Optional diff for PR surfaces
  contextSources: string[];      // Source labels (e.g., "issue", "diff", "retrieval")
};
```

## Audit Logging

Every pipeline run produces an `AuditRecord` that is persisted to the `guardrail_audit` Postgres table via fire-and-forget insert (non-blocking, errors logged but not propagated):

| Field | Description |
|---|---|
| `surface` | Which adapter ran |
| `repo` | Repository identifier |
| `strictness` | Effective strictness level |
| `claims_total` | Total claims extracted |
| `claims_grounded` | Claims that passed |
| `claims_removed` | Claims filtered out |
| `claims_ambiguous` | Claims that hit the LLM fallback |
| `llm_fallback_used` | Whether Haiku was called |
| `response_suppressed` | Whether the entire response was suppressed |
| `classifier_error` | Whether the pipeline hit fail-open |
| `removed_claims` | JSON array of `{text, label, evidence}` for each removed claim |
| `duration_ms` | Pipeline execution time |

## Fail-Open Design

The guardrail pipeline is wrapped in a top-level try/catch. If any error occurs during classification — adapter crash, LLM failure, database error — the original output passes through unchanged. The audit record is logged with `classifierError: true` so the failure is observable without blocking the user.

This applies at multiple levels:
- **Pipeline level** — entire classification fails → output unchanged
- **LLM batch level** — one batch fails → those claims default to grounded, other batches proceed
- **LLM global level** — task router or model call fails → all claims default to grounded
- **Audit level** — audit insert fails → error logged, pipeline result still returned

## Configuration Reference

Guardrail settings live under the `guardrails` key in `.kodiai.yml`. See [Configuration](configuration.md#guardrails) for the full reference.

| Setting | Default | Description |
|---|---|---|
| `guardrails.strictness` | `"standard"` | Global strictness level (`strict` / `standard` / `lenient`) |
| `guardrails.overrides.<surface>.strictness` | inherits global | Per-surface strictness override |
