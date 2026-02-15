# Phase 55: Merge Confidence Scoring - Research

**Researched:** 2026-02-14
**Domain:** Composite signal scoring, prompt engineering, dependency risk assessment
**Confidence:** HIGH

## Summary

Phase 55 synthesizes the three signal categories produced by Phases 53 and 54 -- semver classification, security advisory status, and breaking change detection -- into a single merge confidence score with human-readable rationale. The feature is purely computational (no new API calls, no new dependencies) and integrates at two points: (1) a new pure function that computes a confidence level from the existing `DepBumpContext` fields, and (2) prompt modifications to render the confidence prominently in the review summary.

All input signals already exist in the `DepBumpContext` type: `classification.bumpType` (major/minor/patch/unknown), `classification.isBreaking` (boolean), `security.advisories` (array), `security.isSecurityBump` (boolean), and `changelog.breakingChanges` (array). The scoring function maps combinations of these signals to a confidence level (high/medium/low) with an array of rationale strings explaining each contributing factor.

The primary display mechanism is the LLM-generated summary comment. The existing five-section template (What Changed, Strengths, Observations, Suggestions, Verdict) already renders for dep bump PRs. The merge confidence should be injected into the `## Dependency Bump Context` prompt section so the LLM sees it and can include it in the summary comment's Verdict section. Additionally, the confidence and rationale should appear directly in the prompt section as structured data that the LLM can relay to the reviewer. For silent-approval PRs (no issues found), the confidence can be appended to the approval body so it appears in the review event.

**Primary recommendation:** Create a `computeMergeConfidence` pure function in `dep-bump-detector.ts` (or a new `merge-confidence.ts` module). Add a `mergeConfidence` field to `DepBumpContext`. Compute it after enrichment in `review.ts`. Render it at the top of `buildDepBumpSection` in `review-prompt.ts` as a prominent badge with rationale bullets. Modify the Verdict section instructions to incorporate merge confidence for dep bump PRs.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none needed) | - | Pure function scoring + prompt template changes | No external libraries required |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (existing) vitest | - | Unit tests for scoring function | Already used for all tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Deterministic rule-based scoring | LLM-computed confidence | LLM scoring would be non-deterministic, harder to test, and would consume more tokens. Rule-based is predictable and testable. |
| Numeric score (0-100) | Categorical level (high/medium/low) | Numeric scores suggest false precision. Three levels are sufficient for actionable guidance and match how humans think about risk. |
| Separate module (`merge-confidence.ts`) | Add to `dep-bump-detector.ts` | Separate module is cleaner separation of concerns; the scoring function has no dependency on detection logic, only on the types. Either approach works -- the function is ~30 lines. |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── dep-bump-detector.ts          # EXISTING: types, pipeline
│   ├── dep-bump-enrichment.ts        # EXISTING: advisory/changelog fetch
│   └── merge-confidence.ts           # NEW: scoring function (~50 lines)
│   └── merge-confidence.test.ts      # NEW: comprehensive scoring tests
├── execution/
│   └── review-prompt.ts              # MODIFY: render confidence in dep bump section + verdict
└── handlers/
    └── review.ts                     # MODIFY: compute confidence after enrichment
```

### Pattern 1: Deterministic Signal-to-Confidence Mapping
**What:** A pure function that maps discrete signal combinations to a confidence level. No fuzzy logic, no weights -- just clear rules.
**When to use:** Always for CONF-01.
**Example:**
```typescript
export type MergeConfidenceLevel = "high" | "medium" | "low";

export type MergeConfidence = {
  level: MergeConfidenceLevel;
  rationale: string[];
  emoji: string; // for display: shield icons or traffic light
};

export function computeMergeConfidence(ctx: {
  bumpType: "major" | "minor" | "patch" | "unknown";
  isBreaking: boolean;
  hasAdvisories: boolean;
  isSecurityBump: boolean;
  advisorySeverityMax: "critical" | "high" | "medium" | "low" | "unknown" | null;
  breakingChangesDetected: number;
}): MergeConfidence
```

**Scoring rules:**

Starts at "high", downgrades based on negative signals, upgrades based on positive signals:

| Signal | Effect | Rationale text |
|--------|--------|----------------|
| bumpType === "patch" | Stay high | "Patch version bump (bug fix only)" |
| bumpType === "minor" | Stay high | "Minor version bump (backward-compatible addition)" |
| bumpType === "major" | Downgrade to medium | "Major version bump (potential breaking changes)" |
| bumpType === "unknown" | Downgrade to medium | "Version change could not be classified" |
| hasAdvisories && !isSecurityBump | Downgrade one level | "Security advisories exist for this package" |
| isSecurityBump | Upgrade signal (positive) | "Security-motivated bump (patches known vulnerability)" |
| advisorySeverityMax === "critical" \|\| "high" | Downgrade to low | "Critical/high severity advisory affects this package" |
| breakingChangesDetected > 0 | Downgrade to medium (min) | "Breaking changes detected in changelog" |
| isBreaking && breakingChangesDetected > 0 | Downgrade to low | "Major bump with confirmed breaking changes in changelog" |

Final mapping:
- **High**: patch/minor bump, no advisories (or security-motivated bump that patches them), no breaking changes
- **Medium**: major bump without critical advisories, OR minor/patch with non-critical advisories, OR unknown bump type
- **Low**: major bump with critical/high advisories, OR major bump with confirmed breaking changes, OR any bump where new version still has unpatched advisories

### Pattern 2: Confidence Display in Prompt Section
**What:** Render the merge confidence as the first line of the `## Dependency Bump Context` section with a badge-style indicator.
**When to use:** Always for CONF-02.
**Example:**
```typescript
function renderConfidenceBadge(confidence: MergeConfidence): string {
  const emojiMap = {
    high: ":green_circle:",
    medium: ":yellow_circle:",
    low: ":red_circle:",
  };
  const labelMap = {
    high: "High Confidence",
    medium: "Review Recommended",
    low: "Careful Review Required",
  };

  const lines = [
    `**Merge Confidence: ${emojiMap[confidence.level]} ${labelMap[confidence.level]}**`,
    "",
    ...confidence.rationale.map(r => `- ${r}`),
  ];
  return lines.join("\n");
}
```

### Pattern 3: Extend DepBumpContext (Non-Breaking)
**What:** Add optional `mergeConfidence` field to `DepBumpContext`.
**When to use:** Always.
**Example:**
```typescript
export type DepBumpContext = {
  detection: DepBumpDetection;
  details: DepBumpDetails;
  classification: DepBumpClassification;
  security?: SecurityContext | null;
  changelog?: ChangelogContext | null;
  // Phase 55 addition:
  mergeConfidence?: MergeConfidence | null;
};
```

### Pattern 4: Verdict Integration for Dep Bump PRs
**What:** When merge confidence is present, the summary Verdict section should reflect it. Modify the dep bump prompt section to instruct the LLM to include merge confidence in the Verdict.
**When to use:** For dep bump PRs only.
**Example addition to `buildDepBumpSection`:**
```typescript
if (ctx.mergeConfidence) {
  lines.push(
    "",
    "**Include the following merge confidence assessment in your ## Verdict section:**",
    renderConfidenceBadge(ctx.mergeConfidence),
    "",
    "When writing the Verdict, incorporate the merge confidence level and rationale alongside your own code review findings.",
  );
}
```

### Anti-Patterns to Avoid
- **Numeric scores (0-100):** Suggests false precision. The input signals are categorical, not continuous. Three levels (high/medium/low) are more actionable and honest.
- **LLM-computed confidence:** The LLM already generates a Verdict. Merge confidence is a separate, deterministic assessment from structured signals. Having the LLM compute it would make testing impossible and results non-reproducible.
- **Blocking merge on low confidence:** This is informational guidance, not a gate. The verdict (green/yellow/red) already handles blocking vs. non-blocking assessment based on code review findings.
- **Overriding the code review verdict:** Merge confidence supplements the verdict, it does not replace it. A "high confidence" dep bump can still have code review findings that produce a red verdict.
- **Computing confidence when enrichment data is missing:** If security/changelog data is null (enrichment failed), score based on available signals only and note "enrichment data unavailable" in rationale.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| (nothing applicable) | - | - | This phase is pure business logic with no external dependencies. Everything should be hand-built as simple, testable pure functions. |

**Key insight:** This phase is the opposite of a "don't hand-roll" situation. The scoring function is ~30 lines of deterministic logic. There is no library for this because the signal combination is unique to Kodiai's dependency analysis pipeline.

## Common Pitfalls

### Pitfall 1: Enrichment Absence Misinterpreted as "No Issues"
**What goes wrong:** When enrichment fails (security/changelog both null), the scoring function treats missing data as "no advisories, no breaking changes" and assigns high confidence.
**Why it happens:** null checks defaulting to the positive case.
**How to avoid:** Distinguish between "enrichment confirmed no advisories" (empty array) and "enrichment failed" (null/undefined). When enrichment data is null, either downgrade confidence one level or add "enrichment data unavailable -- confidence may be understated" to rationale.
**Warning signs:** Tests only cover cases where enrichment succeeds.

### Pitfall 2: Confidence Conflicts with Verdict
**What goes wrong:** The LLM sees "High Confidence" merge signal but also found CRITICAL code issues, creating a confusing summary.
**Why it happens:** Merge confidence is about the dependency version change risk; the Verdict is about code review findings. They are independent assessments.
**How to avoid:** Prompt instructions must explicitly state: "Merge confidence reflects dependency version change risk only. Your Verdict reflects code review findings. Both should appear in the summary. If they conflict (e.g., high confidence + critical findings), explain that the dependency change itself is low-risk but code issues exist."
**Warning signs:** LLM conflates the two assessments.

### Pitfall 3: Group Bumps Without Confidence
**What goes wrong:** Group bumps (isGroup: true) skip enrichment, so merge confidence would always be "medium" (unknown signals).
**Why it happens:** Group bumps have no single package to analyze.
**How to avoid:** For group bumps, still compute confidence from the available signals (bumpType if extractable, ecosystem). Add rationale "Group update -- individual package analysis not available."
**Warning signs:** Group bumps produce no confidence output at all.

### Pitfall 4: Security-Motivated Bumps Scored as Risky
**What goes wrong:** A security-motivated bump (patches a vulnerability) gets "low confidence" because advisories exist for the package.
**Why it happens:** Advisories present = downgrade, without checking that the bump is specifically patching them.
**How to avoid:** The `isSecurityBump` flag (Phase 54) indicates the bump patches a vulnerability. This should be a strong positive signal: "This bump patches a known vulnerability." Only advisories affecting the NEW version (not patched by this bump) should be negative signals.
**Warning signs:** Tests don't cover the security-motivated bump case specifically.

### Pitfall 5: Prompt Bloat from Confidence Rationale
**What goes wrong:** The confidence section adds 200+ chars to every dep bump review prompt, and the LLM echoes it verbatim in the summary.
**Why it happens:** Too much instructional text in the confidence rendering.
**How to avoid:** Keep the confidence badge to 3-4 lines max in the prompt. Use brief rationale bullets. Instruct the LLM to "include merge confidence in Verdict" not "reproduce the confidence section verbatim."
**Warning signs:** Dep bump review summaries become repetitive or bloated.

## Code Examples

### Scoring Function
```typescript
// src/lib/merge-confidence.ts
import type { DepBumpContext } from "./dep-bump-detector.ts";

export type MergeConfidenceLevel = "high" | "medium" | "low";

export type MergeConfidence = {
  level: MergeConfidenceLevel;
  rationale: string[];
};

export function computeMergeConfidence(ctx: DepBumpContext): MergeConfidence {
  const rationale: string[] = [];
  let level: MergeConfidenceLevel = "high";

  // --- Semver signal ---
  const { bumpType, isBreaking } = ctx.classification;
  if (bumpType === "patch") {
    rationale.push("Patch version bump (bug fix only)");
  } else if (bumpType === "minor") {
    rationale.push("Minor version bump (backward-compatible)");
  } else if (bumpType === "major") {
    level = "medium";
    rationale.push("Major version bump (potential breaking changes)");
  } else {
    level = "medium";
    rationale.push("Version change could not be classified");
  }

  // --- Advisory signal ---
  const security = ctx.security;
  if (security) {
    if (security.isSecurityBump) {
      rationale.push("Security-motivated bump (patches known vulnerability)");
      // Positive signal -- don't downgrade for advisories that are being patched
    } else if (security.advisories.length > 0) {
      const maxSeverity = getMaxAdvisorySeverity(security.advisories);
      if (maxSeverity === "critical" || maxSeverity === "high") {
        level = "low";
        rationale.push(`${maxSeverity}-severity advisory affects this package`);
      } else {
        if (level === "high") level = "medium";
        rationale.push("Security advisories exist for this package");
      }
    } else {
      rationale.push("No known security advisories");
    }
  } else if (ctx.security === undefined) {
    // Enrichment was not attempted (e.g., group bump)
  } else {
    // Enrichment failed (null)
    rationale.push("Security advisory data unavailable");
  }

  // --- Breaking change signal ---
  const breakingChanges = ctx.changelog?.breakingChanges ?? [];
  if (breakingChanges.length > 0) {
    if (level === "high") level = "medium";
    rationale.push(`${breakingChanges.length} breaking change(s) detected in changelog`);
    // Major + confirmed breaking = low
    if (isBreaking) {
      level = "low";
    }
  } else if (ctx.changelog && ctx.changelog.source !== "compare-url-only") {
    rationale.push("No breaking changes detected in changelog");
  }

  return { level, rationale };
}

function getMaxAdvisorySeverity(
  advisories: Array<{ severity: string }>,
): string {
  const order = ["critical", "high", "medium", "low", "unknown"];
  let maxIdx = order.length - 1;
  for (const adv of advisories) {
    const idx = order.indexOf(adv.severity);
    if (idx !== -1 && idx < maxIdx) maxIdx = idx;
  }
  return order[maxIdx]!;
}
```

### Integration in review.ts
```typescript
// After enrichment block, before buildReviewPrompt:
if (depBumpContext) {
  depBumpContext.mergeConfidence = computeMergeConfidence(depBumpContext);
  logger.info({
    ...baseLog,
    gate: "merge-confidence",
    level: depBumpContext.mergeConfidence.level,
    rationale: depBumpContext.mergeConfidence.rationale,
  }, "Merge confidence computed");
}
```

### Rendering in buildDepBumpSection
```typescript
// At the top of buildDepBumpSection, after the intro line:
if (ctx.mergeConfidence) {
  const emojiMap: Record<MergeConfidenceLevel, string> = {
    high: ":green_circle:",
    medium: ":yellow_circle:",
    low: ":red_circle:",
  };
  const labelMap: Record<MergeConfidenceLevel, string> = {
    high: "High Confidence",
    medium: "Review Recommended",
    low: "Careful Review Required",
  };
  lines.push(
    `**Merge Confidence: ${emojiMap[ctx.mergeConfidence.level]} ${labelMap[ctx.mergeConfidence.level]}**`,
  );
  for (const r of ctx.mergeConfidence.rationale) {
    lines.push(`- ${r}`);
  }
  lines.push("");
}
```

### Verdict Integration Instruction
```typescript
// Added to buildDepBumpSection, near the end:
if (ctx.mergeConfidence) {
  lines.push(
    "",
    "When writing your ## Verdict, include the merge confidence assessment.",
    "Merge confidence reflects dependency version change risk (semver, advisories, breaking changes).",
    "Your Verdict reflects code review findings. Both assessments are independent.",
    "If they conflict, explain why (e.g., 'dependency change is low-risk but code issues exist').",
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No merge confidence | Phase 55 adds deterministic scoring | New (this phase) | Reviewers see risk assessment at a glance |
| LLM-only verdict | Deterministic confidence + LLM verdict | New (this phase) | Structured signals supplement LLM judgment |
| Dep bump context is descriptive only | Dep bump context includes prescriptive confidence | New (this phase) | Actionable guidance beyond raw signal data |

**Deprecated/outdated:**
- None. This is a net-new feature building on Phase 53/54 infrastructure.

## Open Questions

1. **Should confidence appear in the silent-approval body?**
   - What we know: When no issues are found, the LLM does nothing and the handler submits a silent approval with just the idempotency marker. Users see "Approved" with the marker comment.
   - What's unclear: Should high-confidence dep bumps include confidence rationale in the approval body for visibility?
   - Recommendation: Yes -- append a brief confidence line to the approval body for dep bump PRs. This is a small, non-breaking change to the approval path. Example: `<!-- kodiai:review-output-key:xxx -->\n\n:green_circle: **Merge Confidence: High** -- Patch bump, no advisories, no breaking changes`

2. **Should group bumps get a confidence score?**
   - What we know: Group bumps skip enrichment (no single package), so only `bumpType` (usually "unknown" for groups) is available.
   - What's unclear: Is a confidence score based on bumpType alone useful?
   - Recommendation: Compute confidence for group bumps with limited signals. Result will typically be "medium" with rationale "Group update -- individual package analysis not available." This is still informative.

3. **Should the LLM be instructed to render confidence in a specific format?**
   - What we know: The existing summary template has strict section ordering (What Changed, Strengths, Observations, Suggestions, Verdict).
   - What's unclear: Should confidence go in Verdict, in a new section, or in What Changed?
   - Recommendation: Include in Verdict section. The Verdict already synthesizes the overall assessment. Adding merge confidence there (before the verdict emoji line) keeps the template clean and maintains section ordering.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/lib/dep-bump-detector.ts` -- `DepBumpContext`, `DepBumpClassification` types (current implementation)
- Codebase analysis: `src/lib/dep-bump-enrichment.ts` -- `SecurityContext`, `ChangelogContext`, `AdvisoryInfo` types (current implementation)
- Codebase analysis: `src/execution/review-prompt.ts` -- `buildDepBumpSection`, `buildVerdictLogicSection`, summary template, `buildReviewPrompt` context type
- Codebase analysis: `src/handlers/review.ts` -- dep bump detection block (lines ~1387-1465), enrichment wiring, executor call, silent approval path
- Phase 53 summaries: 53-01-SUMMARY.md, 53-02-SUMMARY.md -- detection pipeline architecture and integration decisions
- Phase 54 summaries: 54-01-SUMMARY.md, 54-02-SUMMARY.md -- enrichment module architecture and integration decisions

### Secondary (MEDIUM confidence)
- None needed. All findings are from direct codebase analysis.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; pure function scoring with existing types
- Architecture: HIGH - All integration points identified and verified in codebase; follows established patterns (type extension, prompt section injection, fail-open enrichment)
- Pitfalls: HIGH - Derived from direct analysis of signal combinations and edge cases in existing code
- Scoring logic: HIGH - Deterministic rules with clear rationale; all input signals already exist and are well-typed

**Research date:** 2026-02-14
**Valid until:** 2026-03-16 (stable domain, scoring logic is project-specific)
