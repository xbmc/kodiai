# Phase 126: Global Anti-Hallucination Guardrails - Research

**Researched:** 2026-03-07
**Domain:** Post-generation claim classification and output filtering across all Kodiai surfaces
**Confidence:** HIGH

## Summary

This phase extends Kodiai's existing claim classifier (`claim-classifier.ts`) and output filter (`output-filter.ts`) from PR reviews to all output surfaces: @mentions (issues + PRs), Slack assistant, triage validation, troubleshooting agent, and wiki update suggestions. The codebase already has mature, well-tested implementations of both components -- the work is primarily about generalizing the input/output shapes and wiring adapters for each surface.

The key architectural challenge is that the current classifier is tightly coupled to `DiffContext` (file diffs, added/removed lines). Non-diff surfaces (Slack, triage, troubleshooting) need a "context-grounded evidence model" where any content provided in the prompt context (issue body, PR description, code snippets, wiki chunks, retrieval results) serves as the grounding source instead of diff lines. This requires abstracting `DiffContext` into a broader `GroundingContext` that the classifier can work against.

**Primary recommendation:** Create a unified `GuardrailPipeline` that accepts surface-specific adapters, each defining how to extract claims and grounding context from that surface's output format. Wire it between LLM generation and publishing for every surface.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Surface coverage:**
- All output surfaces get post-generation claim filtering: PR reviews, @mentions (issues + PRs), Slack assistant, triage validation, troubleshooting agent, wiki update suggestions
- Surfaces without a diff use context-grounded evidence model -- anything provided in the prompt context (issue body, PR description, code snippets, wiki chunks, retrieval results) is fair game; claims beyond provided context are flagged
- Wiki update grounding folds into the unified pipeline (no separate system)
- All surfaces use the shared `buildEpistemicBoundarySection` prompt builder -- one source of truth for epistemic instructions

**Pipeline architecture:**
- Single classify-then-filter pipeline with surface adapters -- each surface provides an adapter that extracts claims and context from its output format
- Post-generation, pre-publish placement: LLM generates -> guardrail classifies + filters -> surface publishes
- Global default configuration with per-surface overrides (e.g., Slack could be more lenient for conversational tone)
- Basic strictness toggle exposed in `.kodiai.yml` (strict/standard/lenient) for repo owners

**Detection granularity:**
- Rule-based classifier with LLM fallback -- keep fast regex rules for obvious patterns (version claims, release dates, external-knowledge signals); add Haiku LLM classification for ambiguous cases rules can't catch
- Sentence-level classification on all surfaces -- split response into sentences, classify each against available context; allows surgical removal while keeping the rest
- General programming knowledge allowlisted -- maintain categories always allowed (language semantics, common patterns, well-known algorithms), extending the current PR review exception to all surfaces
- LLM fallback uses Haiku (fast/cheap model) -- good enough for binary grounded/ungrounded decisions, keeps guardrail overhead minimal

**Failure behavior:**
- Silent removal -- remove hallucinated sentences without footnotes or notices; matches current epistemic rule "silently omit what you cannot verify"
- Suppress entirely if response falls below minimum useful threshold after filtering -- better no response than a gutted one (current PR approach: 10 words minimum)
- Log all classification and filter actions to Postgres -- enables analysis of false positive rates, which surfaces hallucinate most, and classifier accuracy over time
- Fail-open on classifier error -- if classifier crashes or times out, let content through; current classifier already defaults to diff-grounded on no signal

### Claude's Discretion

- Per-surface minimum-content thresholds (extending the current 10-word minimum)
- Surface adapter implementation details (how to extract claims from each output format)
- Haiku prompt design for LLM fallback classification
- Database schema for guardrail audit logging
- Allowlist category structure for general programming knowledge

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | (existing) | Schema validation for guardrail config in `.kodiai.yml` | Already used for all config schemas |
| Anthropic Haiku | claude-3-5-haiku-latest | LLM fallback classification for ambiguous claims | Already configured as `slackAssistantModel` default; cheapest/fastest for binary classification |
| postgres (via `src/db/client.ts`) | (existing) | Audit log storage for guardrail actions | Existing pattern for all event logging |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | (existing) | Structured logging of guardrail actions | Every filter/classify action logs through pino |
| `generateWithFallback` | (existing) | LLM calls with model fallback | Haiku classification calls |

No new dependencies required. Everything builds on existing libraries.

## Architecture Patterns

### Recommended Project Structure

```
src/lib/
  guardrail/
    pipeline.ts          # Unified GuardrailPipeline: classify -> filter -> audit
    types.ts             # GroundingContext, SurfaceAdapter, GuardrailConfig, AuditRecord
    context-classifier.ts # Generalized classifier (extends claim-classifier for non-diff surfaces)
    context-filter.ts    # Generalized filter (extends output-filter for markdown/text)
    allowlist.ts         # General programming knowledge categories
    llm-classifier.ts    # Haiku LLM fallback for ambiguous claims
    audit-store.ts       # Postgres audit logging
  claim-classifier.ts    # KEEP - becomes the PR-review-specific adapter's backing implementation
  output-filter.ts       # KEEP - becomes the PR-review-specific adapter's backing implementation
  severity-demoter.ts    # KEEP - PR-review-only, not generalized

src/lib/guardrail/adapters/
    review-adapter.ts    # PR review surface: wraps existing claim-classifier + output-filter
    mention-adapter.ts   # @mention surface: extracts from markdown response
    slack-adapter.ts     # Slack surface: extracts from conversational text
    triage-adapter.ts    # Triage validation surface
    troubleshoot-adapter.ts  # Troubleshooting agent surface
    wiki-adapter.ts      # Wiki update suggestions: replaces wiki-update-generator's checkGrounding
```

### Pattern 1: Surface Adapter Interface

**What:** Each surface implements a `SurfaceAdapter` that defines how to extract claims and grounding context from its specific output format.

**When to use:** Every surface that publishes LLM-generated content.

```typescript
// src/lib/guardrail/types.ts

/** Generalized grounding context -- replaces DiffContext for non-diff surfaces */
export type GroundingContext = {
  /** Text content that is considered "provided context" -- claims matching this are grounded */
  providedContext: string[];
  /** Optional diff context for PR-based surfaces */
  diffContext?: DiffContext;
  /** Source labels for audit trail */
  contextSources: string[];
};

/** Each surface implements this to plug into the pipeline */
export interface SurfaceAdapter<TInput, TOutput> {
  /** Surface identifier for logging/config */
  surface: string;
  /** Extract individual claim sentences from the surface's output */
  extractClaims(output: TOutput): string[];
  /** Build grounding context from the surface's input */
  buildGroundingContext(input: TInput): GroundingContext;
  /** Reconstruct output with filtered claims removed */
  reconstructOutput(output: TOutput, keptClaims: string[]): TOutput;
  /** Minimum useful content threshold (words). Below this, suppress entirely. */
  minContentThreshold: number;
}

export type StrictnessLevel = "strict" | "standard" | "lenient";

export type GuardrailConfig = {
  strictness: StrictnessLevel;
  /** Per-surface overrides */
  overrides?: Partial<Record<string, { strictness?: StrictnessLevel }>>;
};
```

### Pattern 2: Unified Pipeline

**What:** Single entry point that runs classify -> filter -> audit for any surface.

```typescript
// src/lib/guardrail/pipeline.ts

export type GuardrailResult<T> = {
  output: T | null;          // null = suppressed entirely
  claimsTotal: number;
  claimsRemoved: number;
  auditRecords: AuditRecord[];
  suppressed: boolean;
  classifierError: boolean;  // true = fail-open occurred
};

export async function runGuardrailPipeline<TInput, TOutput>(opts: {
  adapter: SurfaceAdapter<TInput, TOutput>;
  input: TInput;
  output: TOutput;
  config: GuardrailConfig;
  logger: Logger;
  auditStore?: AuditStore;
}): Promise<GuardrailResult<TOutput>> {
  // 1. Extract claims from output
  // 2. Build grounding context from input
  // 3. Classify each claim (rule-based, then LLM fallback for ambiguous)
  // 4. Filter: remove ungrounded claims
  // 5. Check minimum content threshold
  // 6. Log audit records to Postgres
  // 7. Return filtered output (or null if suppressed)
}
```

### Pattern 3: Context-Grounded Classification (Non-Diff Surfaces)

**What:** For surfaces without a diff, classification checks whether each claim sentence has word overlap with any provided context (issue body, wiki chunks, retrieval results, etc).

**When to use:** Mentions on issues, Slack messages, troubleshooting, triage.

```typescript
// Grounding check for non-diff surfaces
// Same word-overlap approach as claimReferencesVisibleChange() but against providedContext

export function classifyClaimAgainstContext(
  claim: string,
  context: GroundingContext,
): ClaimClassification {
  // 1. Run regex patterns (VERSION_PATTERN, CVE_PATTERN, etc.) -- same as claim-classifier.ts
  // 2. Check claim word overlap against providedContext strings
  // 3. If overlap >= threshold: "context-grounded" (maps to diff-grounded)
  // 4. If no overlap + external-knowledge signal: "external-knowledge"
  // 5. Default: fail-open to "context-grounded"
}
```

### Pattern 4: Strictness Toggle in .kodiai.yml

**What:** Simple three-level strictness control exposed in repo config.

```yaml
# .kodiai.yml
guardrails:
  strictness: standard  # strict | standard | lenient
```

Maps to classifier behavior:
- **strict:** Lower confidence threshold for LLM fallback (0.4), stricter word-overlap requirements
- **standard:** Current behavior (threshold 0.6)
- **lenient:** Higher threshold (0.8), more permissive -- only obvious hallucinations caught

### Anti-Patterns to Avoid

- **Separate pipelines per surface:** Creates maintenance burden and inconsistency. Use the adapter pattern with a single pipeline.
- **Pre-generation filtering:** The pipeline must run post-generation, pre-publish. Pre-generation approaches (like prompt engineering alone) are necessary but insufficient -- the epistemic prompt is already in place.
- **Blocking on classifier errors:** Always fail-open. A crashing classifier must never prevent publishing content.
- **Exposing individual classifier thresholds in .kodiai.yml:** Keep it simple (strict/standard/lenient). Internal thresholds are implementation details.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sentence splitting | Custom NLP tokenizer | Existing `extractClaims()` regex | Already handles period + uppercase boundary detection; good enough for English |
| Diff parsing | New diff parser | Existing `parseDiffForClassifier()` + `buildFileDiffsMap()` | Proven, tested, handles edge cases |
| Model routing | Hardcoded model IDs | Existing `generateWithFallback()` + `taskRouter` | Built-in fallback and model override support |
| Config validation | Manual parsing | Existing zod schema pattern in `execution/config.ts` | Section-level fallback already implemented |

**Key insight:** The existing claim-classifier.ts and output-filter.ts are well-tested (100+ test cases combined). The generalization should wrap and extend them, not replace them.

## Common Pitfalls

### Pitfall 1: Breaking Existing PR Review Pipeline

**What goes wrong:** Refactoring the classifier to be "generic" breaks the PR review integration that currently works.
**Why it happens:** Temptation to modify claim-classifier.ts directly instead of wrapping it.
**How to avoid:** Keep claim-classifier.ts and output-filter.ts untouched. The review adapter wraps them. New surfaces use the generalized context-classifier.ts.
**Warning signs:** Tests in claim-classifier.test.ts or output-filter.test.ts failing.

### Pitfall 2: Over-Filtering on Non-Diff Surfaces

**What goes wrong:** Context-grounded classification is too aggressive on Slack/mention responses, removing valid content.
**Why it happens:** Word overlap threshold tuned for diffs (where context is specific code) applied to broader conversational context.
**How to avoid:** Tune thresholds per surface through the adapter's config. Slack should be more lenient. Start with lenient defaults and tighten based on audit log analysis.
**Warning signs:** High suppression rates in audit logs for non-PR surfaces.

### Pitfall 3: LLM Fallback Latency

**What goes wrong:** Haiku classification adds noticeable latency to every response.
**Why it happens:** Running LLM classification on every claim, even obviously grounded ones.
**How to avoid:** LLM fallback is only for ambiguous claims (confidence < 0.6 from rule-based). Most claims will be classified by regex rules alone. Batch ambiguous claims into a single Haiku call per response.
**Warning signs:** P95 latency increase on surfaces that previously had no post-gen filtering.

### Pitfall 4: Silent Removal Breaking Response Coherence

**What goes wrong:** Removing sentences from the middle of a response creates incoherent text.
**Why it happens:** Sentence-level removal without considering discourse structure.
**How to avoid:** After removing sentences, check if remaining text flows logically. For markdown responses, preserve heading structure. If removal creates an orphaned heading with no content, remove the heading too.
**Warning signs:** Published responses with non-sequitur transitions or empty sections.

### Pitfall 5: Audit Log Volume

**What goes wrong:** Logging every claim classification for every response creates massive table growth.
**Why it happens:** High-traffic surfaces (PR reviews across many repos) produce many audit records.
**How to avoid:** Log at the response level (aggregate stats) by default. Only log per-claim detail when claims are removed (action taken). Add TTL-based cleanup for old audit records.
**Warning signs:** `guardrail_audit` table growing faster than other tables.

## Code Examples

### Existing Claim Extraction (reuse as-is)

```typescript
// Source: src/lib/claim-classifier.ts:99-109
export function extractClaims(text: string): string[] {
  if (!text || text.trim().length === 0) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return sentences;
}
```

### Existing Filter Pattern (model for generalized filter)

```typescript
// Source: src/lib/output-filter.ts:99-239
// filterExternalClaims() handles: primarily-external -> suppress, mixed -> rewrite, pass-through
// This pattern extends to all surfaces via the adapter's reconstructOutput()
```

### Review Handler Integration Point (model for other surfaces)

```typescript
// Source: src/handlers/review.ts:2993-3121
// Current flow: classifyClaims() -> demoteExternalClaimSeverities() -> filterExternalClaims()
// New flow: runGuardrailPipeline({ adapter: reviewAdapter, input, output, config })
```

### Troubleshooting Agent Integration Point

```typescript
// Source: src/handlers/troubleshooting-agent.ts:179-210
// Current: generateWithFallback() -> formatTroubleshootingComment() -> createComment()
// New: generateWithFallback() -> runGuardrailPipeline() -> formatTroubleshootingComment() -> createComment()
// GroundingContext: result.resolvedIssues texts + result.wikiMatches texts
```

### Mention Handler Integration Point

```typescript
// Source: src/handlers/mention.ts:887
// Current: Agent SDK execution -> createComment(body)
// New: Agent SDK execution -> runGuardrailPipeline(body) -> createComment(filteredBody)
// GroundingContext: issue body, PR description, conversation history, retrieval results
```

### Slack Assistant Integration Point

```typescript
// Source: src/slack/assistant-handler.ts:60
// Current: execute(input) -> publishInThread(answerText)
// New: execute(input) -> runGuardrailPipeline(answerText) -> publishInThread(filteredText)
// GroundingContext: retrieval results, repo code context from executor
```

## Recommended Per-Surface Thresholds

| Surface | Min Content (words) | Strictness Default | Rationale |
|---------|--------------------|--------------------|-----------|
| PR Review | 10 (current) | standard | Structured findings, high stakes |
| @Mention (PR) | 15 | standard | Has diff context, similar to review |
| @Mention (Issue) | 15 | standard | Issue body is primary context |
| Slack | 5 | lenient | Conversational, short responses expected |
| Triage | 10 | standard | Structured output, referenced by users |
| Troubleshooting | 20 | standard | Longer responses, needs substance |
| Wiki Updates | 10 | strict | Published to wiki, highest accuracy needed |

## Recommended Allowlist Categories

General programming knowledge that should always pass through regardless of context grounding:

```typescript
export const GENERAL_PROGRAMMING_ALLOWLIST = {
  // Safety/correctness patterns
  nullSafety: ["null pointer", "null reference", "null dereference", "undefined behavior"],
  injection: ["sql injection", "xss", "cross-site scripting", "command injection"],
  concurrency: ["race condition", "deadlock", "thread safety", "concurrent"],
  resources: ["resource leak", "memory leak", "file handle", "connection leak"],
  bounds: ["off-by-one", "buffer overflow", "out of bounds", "index out of range"],

  // Common patterns
  errorHandling: ["uncaught exception", "unhandled rejection", "error handling", "try-catch"],
  typing: ["type safety", "type assertion", "type mismatch", "type error"],
  codeSmells: ["code smell", "dead code", "unreachable code", "duplicated code"],
};
```

## Database Schema for Audit Logging

```sql
-- Migration 026-guardrail-audit.sql
CREATE TABLE guardrail_audit (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  surface       TEXT NOT NULL,                    -- 'review' | 'mention' | 'slack' | 'triage' | 'troubleshoot' | 'wiki'
  repo          TEXT NOT NULL,                    -- 'owner/repo'
  strictness    TEXT NOT NULL DEFAULT 'standard', -- 'strict' | 'standard' | 'lenient'
  claims_total  INT NOT NULL DEFAULT 0,
  claims_grounded INT NOT NULL DEFAULT 0,
  claims_removed INT NOT NULL DEFAULT 0,
  claims_ambiguous INT NOT NULL DEFAULT 0,        -- sent to LLM fallback
  llm_fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  response_suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  classifier_error BOOLEAN NOT NULL DEFAULT FALSE,
  removed_claims JSONB,                           -- array of { text, label, evidence } for removed claims only
  duration_ms   INT                               -- pipeline execution time
);

CREATE INDEX idx_guardrail_audit_surface ON guardrail_audit (surface);
CREATE INDEX idx_guardrail_audit_repo ON guardrail_audit (repo);
CREATE INDEX idx_guardrail_audit_created ON guardrail_audit (created_at);
```

## Integration Order (Recommended)

1. **Core pipeline + types** -- Build the generalized pipeline, adapter interface, context classifier
2. **Review adapter** -- Wrap existing claim-classifier + output-filter; verify zero behavior change
3. **Config schema** -- Add `guardrails.strictness` to `.kodiai.yml` schema
4. **Audit store** -- Migration + store for logging
5. **Allowlist** -- Extract general programming knowledge categories
6. **LLM fallback** -- Haiku classification for ambiguous claims
7. **Mention adapter** -- Wire @mentions (issues + PRs)
8. **Slack adapter** -- Wire Slack assistant
9. **Troubleshooting adapter** -- Wire troubleshooting agent
10. **Triage adapter** -- Wire triage validation (if it produces LLM text)
11. **Wiki adapter** -- Replace `checkGrounding()` in wiki-update-generator.ts
12. **Epistemic prompt unification** -- Ensure triage + troubleshooting use `buildEpistemicBoundarySection`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Epistemic prompt only (pre-gen) | Prompt + post-gen classifier + filter | Phase 72+ (v0.24) | Catches hallucinations prompt engineering misses |
| PR-review-only filtering | Unified pipeline for all surfaces | Phase 126 (this phase) | Consistent hallucination prevention everywhere |
| Wiki-specific grounding check | Unified pipeline adapter | Phase 126 (this phase) | Eliminates duplicate grounding logic |

## Open Questions

1. **Mention handler output format**
   - What we know: Agent SDK execution returns `answerText` as markdown string
   - What's unclear: Exactly what context is available at the point where we'd insert the guardrail (the executor runs inside Agent SDK)
   - Recommendation: Inject guardrail as a post-processing step on the final `answerText` before `createComment()`. Grounding context must be collected before execution starts and passed through.

2. **Triage surface output**
   - What we know: Triage uses `formatTriageComment()` to build structured output from classification results
   - What's unclear: Whether triage output contains LLM-generated prose that needs filtering (vs. structured template output)
   - Recommendation: Investigate `formatTriageComment()` -- if it's purely template-based with no LLM prose, triage may not need post-gen filtering (only the epistemic prompt addition).

3. **LLM fallback batching**
   - What we know: Individual Haiku calls per ambiguous claim would be expensive
   - What's unclear: Optimal batch size and prompt format for classifying multiple claims in one call
   - Recommendation: Batch all ambiguous claims from a single response into one Haiku call with JSON array output. Test with 5-10 claims per batch.

## Sources

### Primary (HIGH confidence)
- `src/lib/claim-classifier.ts` -- Full source read, all patterns and types documented
- `src/lib/output-filter.ts` -- Full source read, filter logic and types documented
- `src/execution/review-prompt.ts` -- `buildEpistemicBoundarySection()` full implementation read
- `src/execution/config.ts` -- Complete `.kodiai.yml` schema read, all existing config sections documented
- `src/handlers/review.ts:2980-3140` -- Integration point where classifier+filter are wired
- `src/handlers/troubleshooting-agent.ts:65-210` -- No epistemic guardrails, generates via `generateWithFallback()`
- `src/slack/assistant-handler.ts:1-200` -- Uses `buildEpistemicBoundarySection()` but no post-gen filtering
- `src/execution/mention-prompt.ts` -- Uses `buildEpistemicBoundarySection()` but no post-gen filtering
- `src/knowledge/wiki-update-generator.ts` -- Has its own `checkGrounding()` that should fold in
- `src/llm/task-types.ts` -- All task types, Haiku already used for slack.response

### Secondary (MEDIUM confidence)
- Integration pattern analysis across all handler files
- Migration numbering from `src/db/migrations/` (next: 026)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all existing libraries, no new dependencies
- Architecture: HIGH -- clear adapter pattern, well-understood integration points, all source code read
- Pitfalls: HIGH -- based on actual code structure and observed patterns
- Per-surface thresholds: MEDIUM -- recommendations are reasonable defaults but need tuning based on production data

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable domain, no external dependencies changing)
