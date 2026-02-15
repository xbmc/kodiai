# Phase 38: Delta Re-Review Formatting - Research

**Researched:** 2026-02-13
**Domain:** PR re-review output formatting, delta classification rendering, prompt engineering for incremental review templates, sanitizer validation for delta-specific comment structure
**Confidence:** HIGH

## Summary

Phase 38 transforms how re-review comments are formatted when a PR is reviewed incrementally. Currently, the system has all the infrastructure for delta classification (the `classifyFindingDeltas()` function in `delta-classifier.ts` computes new/resolved/still-open status for each finding), but this data is only used for telemetry logging -- it never reaches the summary comment template or the prompt. The delta classification result (`DeltaClassification`) is computed in `review.ts` after finding extraction and processing, producing counts and annotated findings, but the prompt continues to instruct Claude to use the standard five-section template even for re-reviews.

The implementation requires three coordinated changes: (1) a new delta-specific summary template in `review-prompt.ts` that replaces the standard five-section template when an incremental re-review is detected -- using sections "What Changed", "New Findings", "Resolved Findings", "Still Open", and "Verdict Update" with delta-specific verdict states; (2) passing the delta classification data to the prompt builder so Claude knows which findings are new vs resolved vs still-open, enabling it to produce the delta template instead of the standard template; and (3) a parallel sanitizer path in `comment-server.ts` that validates the delta template structure (distinct from the initial review five-section template). Crucially, the `DeltaClassification` object already exists and has all the data needed -- the work is entirely about threading it through to the prompt and formatting the output.

The existing `buildIncrementalReviewSection()` in `review-prompt.ts` already adds context about incremental mode (files changed since last review, prior SHA), but it does NOT change the summary comment template -- Claude still uses the standard five-section format. Phase 38 changes the ENTIRE summary comment template when in incremental mode to a delta-focused structure.

**Primary recommendation:** Add a `deltaContext` parameter to `buildReviewPrompt()` carrying the `DeltaClassification` data. When present, replace the standard five-section summary comment template with a delta template. Add a `sanitizeKodiaiReReviewSummary()` function (or a branch in the existing sanitizer) that validates the delta template structure. Pass `deltaClassification` from `review.ts` to `buildReviewPrompt()` to close the data flow gap.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | -- | -- | All existing deps are sufficient |

This phase requires zero new dependencies. All changes are in existing files:

- `src/execution/review-prompt.ts` -- prompt construction (add delta template, modify `buildReviewPrompt()`)
- `src/execution/mcp/comment-server.ts` -- sanitizer validation (add delta template validation path)
- `src/handlers/review.ts` -- thread `deltaClassification` to prompt builder
- `src/lib/delta-classifier.ts` -- already exists and is complete (no changes needed)

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bun:test | existing | Test framework | For all new tests |

### Alternatives Considered

None -- this phase is purely about prompt template changes, data threading, and sanitizer updates within the existing architecture.

## Architecture Patterns

### Current Data Flow (Must Understand)

The delta classification data already exists but is disconnected from the output formatting:

```
review.ts (handleReview):
  1. computeIncrementalDiff() -> IncrementalDiffResult { mode, changedFilesSinceLastReview, lastReviewedHeadSha }
  2. buildReviewPrompt() <- incrementalContext { lastReviewedHeadSha, changedFiles, unresolvedPriorFindings }
     -> Adds "## Incremental Review Mode" section to prompt, BUT summary template is unchanged
  3. executor.execute() -> Claude generates standard five-section summary
  4. extractFindingsFromReviewComments() -> ExtractedFinding[]
  5. classifyFindingDeltas() -> DeltaClassification { current[], resolved[], counts }
     -> THIS DATA IS ONLY LOGGED, NOT USED IN OUTPUT
  6. formatReviewDetailsSummary() -> deterministic Review Details block
  7. appendReviewDetailsToSummary() -> appends to summary comment
```

**Key gap:** Step 5 produces `DeltaClassification` but it's computed AFTER the summary comment has already been posted by Claude in step 3. The delta data cannot influence the Claude-generated summary because it arrives too late.

**Phase 38 must solve this timing problem.** Two approaches:

1. **Post-hoc delta comment:** Let Claude generate the standard template, then post a SECOND comment with the delta summary constructed deterministically from `DeltaClassification`. This avoids changing the prompt but adds comment noise.

2. **Prompt-driven delta template (recommended):** Pass delta data to the prompt BEFORE execution so Claude generates the delta template directly. This requires passing `DeltaClassification` from the PRIOR review's findings (which are available before execution via `getPriorReviewFindings()`) to the prompt builder. The delta classification against CURRENT findings happens post-execution, but the PRIOR findings data (what was found last time) is available pre-execution and is sufficient for instructing Claude to use the delta template.

### Solving the Timing Problem

**What Claude needs to know pre-execution to use the delta template:**
- That this is a re-review (already known via `incrementalContext`)
- The previous review's SHA (already available via `incrementalResult.lastReviewedHeadSha`)
- The prior review's findings (already available via `knowledgeStore.getPriorReviewFindings()`)
- Which files changed since the last review (already available via `incrementalResult.changedFilesSinceLastReview`)

**What happens post-execution:**
- Current findings are extracted and classified against prior findings
- Delta counts are computed (new, resolved, still-open)
- The deterministic Review Details block is appended

**Insight:** Claude does NOT need the post-execution `DeltaClassification` to produce the delta template. It needs the PRIOR findings to know what was found before, and the current diff to know what changed. Claude can then naturally produce:
- "New Findings" = issues it finds in the current review that weren't in the prior findings list
- "Resolved Findings" = prior findings that are no longer present in the code Claude is reviewing
- "Still Open" = prior findings that Claude re-encounters in unchanged code

The prompt already has `unresolvedPriorFindings` (from `buildPriorFindingContext()`) -- the unresolved findings on unchanged code. It also has `changedFilesSinceLastReview`. The gap is: the prompt does not currently include the FULL prior findings list (including those on changed files), and it does not instruct Claude to use a delta template.

### Target Data Flow

```
review.ts (handleReview):
  1. computeIncrementalDiff() -> IncrementalDiffResult
  2. knowledgeStore.getPriorReviewFindings() -> PriorFinding[] (ALREADY FETCHED)
  3. buildReviewPrompt() <- incrementalContext + deltaContext {
       isReReview: true,
       lastReviewedHeadSha: string,
       priorFindings: PriorFinding[],     // Full prior findings list
       changedFilesSinceLastReview: string[],
     }
     -> Produces delta summary template instead of five-section template
  4. executor.execute() -> Claude generates delta-formatted summary
  5. sanitizeKodiaiReReviewSummary() validates delta template structure
  6. Post-execution: classifyFindingDeltas() for telemetry (unchanged)
```

### New Delta Summary Template (FORMAT-14)

```markdown
<details>
<summary>Kodiai Re-Review Summary</summary>

## Re-review -- Changes since abc1234

## What Changed
<1-2 sentence summary of what changed since the last review>

## New Findings
:new: [CRITICAL] src/auth.ts (42): SQL injection in login query
<explanation of the new issue>

:new: [MAJOR] src/db.ts (15): Missing transaction for batch write
<explanation of the new issue>

## Resolved Findings
:white_check_mark: [CRITICAL] src/auth.ts: Hardcoded secret key -- resolved
:white_check_mark: [MAJOR] src/api.ts: Missing rate limiting -- resolved

## Still Open
<count> finding(s) from the previous review remain open.

<details>
<summary>View still-open findings</summary>

- [MEDIUM] src/utils.ts (10): Missing null check
- [MINOR] src/format.ts (3): Inconsistent indentation

</details>

## Verdict Update
:green_circle: **Blockers resolved** -- Ready to merge
:yellow_circle: **New blockers found** -- Address [N] new issue(s)
:large_blue_circle: **Still ready** -- No new issues

</details>
```

### Delta Verdict States (FORMAT-15)

The delta verdict is DIFFERENT from the initial review verdict. It describes the TRANSITION, not the absolute state:

| State | Emoji | When | Label |
|-------|-------|------|-------|
| New blockers found | :yellow_circle: | New CRITICAL/MAJOR findings appeared | **New blockers found** -- Address [N] new issue(s) |
| Blockers resolved | :green_circle: | Prior blockers are resolved, no new blockers | **Blockers resolved** -- Ready to merge |
| Still ready | :large_blue_circle: | No blockers before or after | **Still ready** -- No new issues |
| Mixed | :yellow_circle: | Some blockers resolved but new ones appeared | **New blockers found** -- Address [N] new issue(s) |

**Key distinction from initial review verdict:**
- Initial review: `:green_circle:` = zero findings, `:yellow_circle:` = non-blocking findings, `:red_circle:` = blockers
- Delta review: `:green_circle:` = blockers resolved, `:yellow_circle:` = new blockers, `:large_blue_circle:` = stable (no change in blocker status)

**Why `:large_blue_circle:` instead of `:green_circle:` for "Still ready"?** To distinguish from "Blockers resolved." When a maintainer sees green in a re-review, it means something IMPROVED. Blue means nothing changed (still fine). This prevents confusion where green could mean "was good, still good" vs "was bad, now good."

### Pattern 1: Conditional Summary Template in Prompt Builder

**What:** `buildReviewPrompt()` switches between the standard five-section template and the delta template based on whether `deltaContext` is provided.

**Implementation approach:**

```typescript
// In buildReviewPrompt(), after the "## Summary comment" section:

if (context.deltaContext) {
  // Delta re-review template
  lines.push(
    "",
    "## Summary comment (Re-Review Mode)",
    "",
    "This is a re-review. Use the delta template instead of the standard five-section template.",
    "",
    "Post ONE summary comment using the delta format:",
    "",
    "<details>",
    "<summary>Kodiai Re-Review Summary</summary>",
    "",
    `## Re-review -- Changes since ${context.deltaContext.lastReviewedHeadSha.slice(0, 7)}`,
    "",
    "## What Changed",
    "<1-2 sentence summary of changes since the last review>",
    "",
    "## New Findings",
    ":new: [SEVERITY] path/to/file.ts (lines): <issue title>",
    "<explanation>",
    "",
    "## Resolved Findings",
    ":white_check_mark: [SEVERITY] path/to/file.ts: <issue title> -- resolved",
    "",
    "## Still Open",
    "<count> finding(s) from the previous review remain open.",
    "",
    "<details>",
    "<summary>View still-open findings</summary>",
    "",
    "- [SEVERITY] path/to/file.ts (lines): <issue title>",
    "",
    "</details>",
    "",
    "## Verdict Update",
    ":green_circle: **Blockers resolved** -- Ready to merge",
    ":yellow_circle: **New blockers found** -- Address [N] new issue(s)",
    ":large_blue_circle: **Still ready** -- No new issues",
    "",
    "</details>",
  );
} else {
  // Standard five-section template (existing code)
  // ... existing code unchanged ...
}
```

### Pattern 2: Prior Findings in Prompt Context

**What:** The prior findings must be listed in the prompt so Claude can determine which findings are "new" vs "resolved" vs "still-open."

**Implementation approach:** Extend the existing `buildIncrementalReviewSection()` to include prior findings for the delta template, or create a new `buildDeltaReviewContext()` function.

```typescript
export function buildDeltaReviewContext(params: {
  lastReviewedHeadSha: string;
  changedFilesSinceLastReview: string[];
  priorFindings: PriorFinding[];
}): string {
  const sha7 = params.lastReviewedHeadSha.slice(0, 7);
  const lines: string[] = [
    "## Delta Review Context",
    "",
    `This is an incremental re-review. The last review covered commit ${sha7}.`,
    "",
    `### Files changed since last review (${params.changedFilesSinceLastReview.length}):`,
  ];

  const capped = params.changedFilesSinceLastReview.slice(0, 50);
  for (const file of capped) {
    lines.push(`- ${file}`);
  }
  if (params.changedFilesSinceLastReview.length > 50) {
    lines.push(`- ...(${params.changedFilesSinceLastReview.length - 50} more)`);
  }

  if (params.priorFindings.length > 0) {
    lines.push(
      "",
      `### Prior review findings (${params.priorFindings.length}):`,
      "",
      "Compare your current findings against these. Classify each as:",
      "- **NEW**: found now but not in the prior list",
      "- **RESOLVED**: was in the prior list but no longer applies",
      "- **STILL OPEN**: was in the prior list and still applies",
      "",
    );
    const cappedFindings = params.priorFindings.slice(0, 30);
    for (const f of cappedFindings) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.filePath}: ${f.title}`);
    }
    if (params.priorFindings.length > 30) {
      lines.push(`- ...(${params.priorFindings.length - 30} more findings omitted)`);
    }
  }

  return lines.join("\n");
}
```

### Pattern 3: Delta Sanitizer Validation

**What:** The sanitizer must validate the delta template structure separately from the initial review template. The key discriminator is the `<summary>Kodiai Re-Review Summary</summary>` tag vs `<summary>Kodiai Review Summary</summary>`.

**Implementation approach:** Add a branch in `sanitizeKodiaiReviewSummary()` or create a parallel function:

```typescript
function sanitizeKodiaiReReviewSummary(body: string): string {
  if (!body.includes("<summary>Kodiai Re-Review Summary</summary>")) {
    return body;
  }

  // Delta template required sections
  const requiredSections = [
    "## Re-review",
    "## What Changed",
    "## Verdict Update",
  ];

  // At least one of these must be present (can have New Findings, Resolved, or Still Open)
  const deltaSections = [
    "## New Findings",
    "## Resolved Findings",
    "## Still Open",
  ];

  for (const section of requiredSections) {
    if (!body.includes(section)) {
      throw new Error(
        `Invalid Kodiai re-review summary: missing required section '${section}'`
      );
    }
  }

  const hasAnyDeltaSection = deltaSections.some(s => body.includes(s));
  if (!hasAnyDeltaSection) {
    throw new Error(
      "Invalid Kodiai re-review summary: must contain at least one of: New Findings, Resolved Findings, Still Open"
    );
  }

  // Verdict Update format validation
  const verdictStart = body.indexOf("## Verdict Update");
  const verdictSection = body.slice(verdictStart);
  const deltaVerdictRe =
    /^:(green_circle|yellow_circle|large_blue_circle): \*\*[^*]+\*\* -- .+$/m;
  if (!deltaVerdictRe.test(verdictSection)) {
    throw new Error(
      "Invalid Kodiai re-review summary: Verdict Update must use format ':emoji: **Label** -- explanation'"
    );
  }

  return body;
}
```

### Pattern 4: NEW and Checkmark Badges (FORMAT-16)

**What:** New findings use `:new:` badge prefix, resolved findings use `:white_check_mark:` badge prefix, still-open findings appear as a count with expandable list.

**GitHub rendering:**
- `:new:` renders as a red "NEW" badge emoji
- `:white_check_mark:` renders as a green checkmark emoji (already used in Strengths section)

**Prompt instruction for badges:**

```
- NEW findings: prefix each finding line with :new: before the severity tag
  Example: :new: [CRITICAL] src/auth.ts (42): SQL injection in login query
- RESOLVED findings: prefix each with :white_check_mark: and append " -- resolved"
  Example: :white_check_mark: [CRITICAL] src/auth.ts: Hardcoded secret key -- resolved
- STILL OPEN: show count only in the main body, with an expandable list using <details>
```

### Pattern 5: Threading Delta Context in review.ts

**What:** Pass the delta context to `buildReviewPrompt()`. The prior findings are already fetched in `review.ts` for dedup purposes. The change is to also pass them (and the `isReReview` flag) to the prompt builder.

**Key code location:** In `review.ts`, around lines 1091-1110, where `priorFindingCtx` is built, the `priorFindings` array is available. And `incrementalResult.mode === "incremental"` indicates a re-review.

```typescript
// Build review prompt
const reviewPrompt = buildReviewPrompt({
  // ... existing params ...
  // NEW: Delta review context for FORMAT-14/15/16
  deltaContext: incrementalResult?.mode === "incremental" && priorFindings && priorFindings.length > 0
    ? {
        lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
        changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
        priorFindings,
      }
    : null,
});
```

**Note:** The `priorFindings` variable is currently scoped inside the `if (knowledgeStore && incrementalResult?.mode === "incremental")` block. It needs to be hoisted to be available for the prompt builder call.

### Pattern 6: Section Omission for Clean Delta

**What:** If a delta review has zero new findings, zero resolved findings, or zero still-open findings, the corresponding section should be omitted entirely rather than showing an empty section.

**Prompt instruction:**
```
- If there are no new findings, omit ## New Findings entirely
- If there are no resolved findings, omit ## Resolved Findings entirely
- If there are no still-open findings, omit ## Still Open entirely
- At least one of these three sections must be present (otherwise there's nothing to report)
```

**When to not post:** If a re-review produces zero new findings AND zero resolved findings AND zero still-open findings, Claude should not post any summary comment (same as the initial review "no issues" path).

### Anti-Patterns to Avoid

- **Anti-pattern: Repeating unchanged findings in the main body.** The SUCCESS criterion #4 says "Findings that have not changed since the previous review are not repeated in the main body." Still-open findings appear ONLY as a count + expandable list, NOT as full finding entries.

- **Anti-pattern: Using the same verdict states for initial and delta reviews.** The delta verdict describes a TRANSITION ("Blockers resolved", "New blockers found", "Still ready"), not an absolute state ("Ready to merge", "Address before merging"). Using the same labels would confuse maintainers.

- **Anti-pattern: Making the delta template mandatory for all re-reviews.** If `knowledgeStore` is unavailable or prior findings are empty, fall back to the standard five-section template. The delta template requires prior finding data to be meaningful.

- **Anti-pattern: Posting both a standard summary AND a delta summary.** When in delta mode, ONLY the delta template is used. The standard five-section template is suppressed.

- **Anti-pattern: Including inline comment details in the Resolved Findings section.** Resolved findings are listed as one-liners (severity + path + title + "resolved"). They do NOT include explanations or line numbers since the code may have changed.

- **Anti-pattern: Validating the delta sanitizer against Impact/Preference subsections.** The delta template does NOT use `### Impact` / `### Preference` subsections. It uses `## New Findings` / `## Resolved Findings` / `## Still Open` as its organizational structure. The finding severity tags (`[CRITICAL]`, etc.) remain but are not grouped by Impact/Preference.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding comparison logic | Custom finding diff algorithm | `classifyFindingDeltas()` in `delta-classifier.ts` | Already exists, tested, uses FNV-1a fingerprinting |
| Prior finding retrieval | Custom DB query | `knowledgeStore.getPriorReviewFindings()` | Already exists in knowledge store interface |
| Incremental detection | Custom SHA comparison | `computeIncrementalDiff()` in `incremental-diff.ts` | Already exists, handles deepen/unshallow |
| Finding fingerprinting | Custom hash function | `fingerprintFindingTitle()` in `review.ts` | Already exists, FNV-1a based |
| Review output marker | Custom idempotency tokens | `buildReviewOutputMarker()` / `buildReviewOutputKey()` | Already exists for both initial and re-reviews |

**Key insight:** All the DATA infrastructure for Phase 38 already exists. The delta classifier, prior finding retrieval, incremental diff computation, and fingerprinting are all implemented and tested. Phase 38 is purely about FORMATTING -- threading the existing data through to the prompt template and sanitizer.

## Common Pitfalls

### Pitfall 1: Timing of Delta Classification vs Summary Posting

**What goes wrong:** Attempting to pass the post-execution `DeltaClassification` to the prompt, but the prompt runs BEFORE execution.
**Why it happens:** The delta classification runs on CURRENT findings (extracted from review comments after Claude posts them). The prompt runs BEFORE Claude executes.
**How to avoid:** Pass the PRIOR findings to the prompt. Claude compares its current analysis against the prior findings to produce the delta template naturally. The post-execution `DeltaClassification` is only used for telemetry and the deterministic Review Details block.
**Warning signs:** Attempting to move `classifyFindingDeltas()` before `executor.execute()` -- this is impossible because current findings don't exist yet.

### Pitfall 2: Sanitizer Not Discriminating Initial vs Delta Template

**What goes wrong:** The sanitizer tries to validate a delta template against the five-section rules, or vice versa.
**Why it happens:** Both templates are posted as issue comments through the same MCP comment server.
**How to avoid:** Use the `<summary>` tag content as the discriminator: `"Kodiai Review Summary"` triggers the five-section validator, `"Kodiai Re-Review Summary"` triggers the delta validator. Non-review comments pass through unchanged (existing behavior).
**Warning signs:** Sanitizer errors on valid delta templates mentioning "missing required section '## Observations'".

### Pitfall 3: Empty Delta Sections

**What goes wrong:** Claude produces empty sections like "## Resolved Findings\n(none)" which adds visual noise.
**Why it happens:** The template shows all sections, and Claude fills them even when empty.
**How to avoid:** Prompt instructions must say "Omit [section] entirely if there are no [items]." The sanitizer must NOT require all three delta sections -- at least one must be present, but any can be omitted.
**Warning signs:** Delta summaries with "## Resolved Findings\nNo findings were resolved." appearing in production.

### Pitfall 4: Still-Open Findings Repeated in Main Body

**What goes wrong:** Claude lists still-open findings as full finding entries (with explanations) in the main body, effectively repeating the prior review.
**Why it happens:** Claude's default behavior is to be thorough and describe all issues it finds.
**How to avoid:** The prompt must explicitly say: "Still-open findings appear ONLY in the ## Still Open section as a count and expandable list. Do NOT include them in ## New Findings. Do NOT re-explain still-open findings." The discriminator is: if a finding matches a prior finding (same file + similar title), it goes to Still Open, not New Findings.
**Warning signs:** Delta summaries that are as long as initial reviews.

### Pitfall 5: Delta Verdict Logic Not Matching Transition States

**What goes wrong:** Claude uses initial-review verdict labels in a re-review, or produces verdicts that don't reflect the transition.
**Why it happens:** The initial review verdict logic is deeply embedded in the prompt. If the delta template section is not sufficiently clear, Claude may default to the familiar labels.
**How to avoid:** The delta summary comment section must include its OWN "Verdict Update Logic" section that is distinct from the initial review's "Verdict Logic" section. The two should not coexist in the same prompt -- use conditional inclusion.
**Warning signs:** Re-reviews showing `:red_circle: **Address before merging**` instead of `:yellow_circle: **New blockers found**`.

### Pitfall 6: Breaking Initial Review Path

**What goes wrong:** Changes to `buildReviewPrompt()` accidentally affect initial reviews (non-incremental mode).
**Why it happens:** The delta template conditional is interleaved with existing code.
**How to avoid:** Gate ALL delta template changes on `context.deltaContext`. The existing five-section template path must remain completely unchanged. Write tests for both paths: initial review produces five-section template, re-review produces delta template.
**Warning signs:** Existing review-prompt tests failing after changes.

### Pitfall 7: Prior Findings Variable Scoping

**What goes wrong:** The `priorFindings` variable is only available inside the `if (knowledgeStore && incrementalResult?.mode === "incremental")` block in `review.ts`, but it's needed in the `buildReviewPrompt()` call that's outside this block.
**Why it happens:** The current code structure scopes `priorFindings` to the dedup context block.
**How to avoid:** Hoist the `priorFindings` variable to the same scope level as `priorFindingCtx`. The variable is already fetched from `knowledgeStore.getPriorReviewFindings()` -- just declare it at a higher scope and assign it inside the conditional.
**Warning signs:** TypeScript error "Cannot find name 'priorFindings'" at the `buildReviewPrompt()` call site.

## Code Examples

### Example 1: Delta Context Type for Prompt Builder

```typescript
// New type added to review-prompt.ts

export type DeltaReviewContext = {
  lastReviewedHeadSha: string;
  changedFilesSinceLastReview: string[];
  priorFindings: Array<{
    filePath: string;
    title: string;
    severity: string;
    category: string;
  }>;
};
```

### Example 2: Conditional Template Selection in buildReviewPrompt

```typescript
// In buildReviewPrompt(), the "## Summary comment" section becomes conditional:

if (context.deltaContext) {
  // Delta re-review mode: use delta template
  const sha7 = context.deltaContext.lastReviewedHeadSha.slice(0, 7);

  lines.push(
    "",
    "## Summary comment (Re-Review Mode)",
    "",
    `This is a re-review. The previous review was at commit ${sha7}. Use the DELTA template, NOT the standard five-section template.`,
    "",
    // ... delta template with instructions ...
  );

  // Delta verdict logic (replaces standard verdict logic)
  lines.push("", buildDeltaVerdictLogicSection());

  // Delta hard requirements
  lines.push(
    "",
    "Hard requirements for the re-review summary:",
    "- Use <summary>Kodiai Re-Review Summary</summary> (NOT 'Kodiai Review Summary')",
    "- ## Re-review header is REQUIRED with reference to the prior SHA",
    "- ## What Changed is REQUIRED",
    "- ## Verdict Update is REQUIRED",
    "- ## New Findings, ## Resolved Findings, ## Still Open are each OPTIONAL but at least one must be present",
    "- Omit empty sections entirely (do NOT write '## New Findings\\n(none)')",
    "- Do NOT repeat still-open findings in ## New Findings",
    "- Still-open findings appear ONLY in ## Still Open as count + expandable <details> list",
    "- New findings use :new: badge before the severity tag",
    "- Resolved findings use :white_check_mark: badge and append ' -- resolved'",
  );
} else {
  // Standard five-section template (existing code, unchanged)
  // ...
}
```

### Example 3: Delta Verdict Logic Section

```typescript
export function buildDeltaVerdictLogicSection(): string {
  return [
    "## Verdict Update Logic",
    "",
    "The delta verdict describes the TRANSITION from the previous review, not the absolute state.",
    "",
    "Determining the verdict update:",
    "1. Count new [CRITICAL] and [MAJOR] findings in ## New Findings.",
    "2. If new blockers > 0: use :yellow_circle: **New blockers found** -- Address [N] new issue(s)",
    "3. If new blockers == 0 AND prior blockers were resolved (## Resolved Findings contains CRITICAL/MAJOR): use :green_circle: **Blockers resolved** -- Ready to merge",
    "4. If new blockers == 0 AND no prior blockers were resolved (or no prior blockers existed): use :large_blue_circle: **Still ready** -- No new issues",
    "",
    "Use :green_circle: specifically when the situation IMPROVED (blockers went away).",
    "Use :large_blue_circle: when the situation is UNCHANGED (was good, still good).",
    "Use :yellow_circle: when the situation WORSENED (new blockers appeared).",
  ].join("\\n");
}
```

### Example 4: Threading Delta Context in review.ts

```typescript
// In review.ts, hoist priorFindings and pass to prompt:

// Before the buildReviewPrompt call, declare at the same scope level:
let priorFindings: PriorFinding[] = [];

if (knowledgeStore && incrementalResult?.mode === "incremental") {
  try {
    priorFindings = knowledgeStore.getPriorReviewFindings({
      repo: `${apiOwner}/${apiRepo}`,
      prNumber: pr.number,
    });
    if (priorFindings.length > 0) {
      priorFindingCtx = buildPriorFindingContext({
        priorFindings,
        changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
      });
    }
  } catch (err) {
    logger.warn({ ...baseLog, err }, "Prior finding context failed (fail-open, no dedup)");
  }
}

// Then in buildReviewPrompt call:
const reviewPrompt = buildReviewPrompt({
  // ... existing params ...
  deltaContext: incrementalResult?.mode === "incremental" && priorFindings.length > 0
    ? {
        lastReviewedHeadSha: incrementalResult.lastReviewedHeadSha!,
        changedFilesSinceLastReview: incrementalResult.changedFilesSinceLastReview,
        priorFindings: priorFindings.map(f => ({
          filePath: f.filePath,
          title: f.title,
          severity: f.severity,
          category: f.category,
        })),
      }
    : null,
});
```

### Example 5: Delta Sanitizer Branch

```typescript
// In comment-server.ts, add discrimination before existing sanitizer:

function sanitizeKodiaiReviewOrReReviewSummary(body: string): string {
  if (body.includes("<summary>Kodiai Re-Review Summary</summary>")) {
    return sanitizeKodiaiReReviewSummary(body);
  }
  if (body.includes("<summary>Kodiai Review Summary</summary>")) {
    return sanitizeKodiaiReviewSummary(body);
  }
  return body;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No incremental review | `computeIncrementalDiff()` with `changedFilesSinceLastReview` | Phase 30-33 | Review focuses on delta files |
| No prior finding dedup | `buildPriorFindingContext()` + `shouldSuppressFinding()` | Phase 30-33 | Duplicate findings suppressed |
| No delta classification | `classifyFindingDeltas()` with new/resolved/still-open labels | Phase 33 | Delta data computed but only logged |
| Standard template for all reviews | Five-section template (What Changed, Strengths, Observations, Suggestions, Verdict) | Phase 34-36 | Structured initial review output |
| No separate re-review format | Same template for initial and re-reviews | Phase 34-37 | Re-reviews produce full structure even when most findings are unchanged |

**What changes with Phase 38:**
- Re-reviews get a distinct delta template (not the standard five-section template)
- Prior findings are listed in the prompt for Claude to compare against
- Delta sections (New Findings, Resolved Findings, Still Open) replace Observations
- Delta verdict describes the transition, not the absolute state
- Unchanged findings are not repeated in the main body

## Open Questions

1. **Should the "Still Open" section include severity and file path for each finding, or just the title?**
   - What we know: Still-open findings are prior findings that haven't changed. Including file path and severity helps the maintainer identify them.
   - What's unclear: Whether line numbers should be included (they may have shifted due to surrounding code changes even if the finding is on unchanged code).
   - Recommendation: Include severity and file path but NOT line numbers for still-open findings. The finding title and path are sufficient for identification. Line numbers are fragile and may be stale.

2. **Should the sanitizer validate that New Findings use `:new:` badges?**
   - What we know: The initial review sanitizer does NOT validate Strengths `:white_check_mark:` badges (prompt-driven only).
   - What's unclear: Whether to enforce badge consistency in the sanitizer or leave it prompt-driven.
   - Recommendation: Do NOT validate badges in the sanitizer. Follow the same pattern as Strengths: badges are prompt-driven, not sanitizer-enforced. The sanitizer validates section structure and verdict format only.

3. **Should the Re-review header include both the prior SHA and the current SHA?**
   - What we know: FORMAT-14 says `"Re-review -- Changes since [previous review SHA]"`. The current SHA is available from `pr.head.sha` but is not explicitly mentioned.
   - What's unclear: Whether including the current SHA adds useful context or is redundant (the PR page already shows the current HEAD).
   - Recommendation: Include only the previous review SHA in the header, as specified in FORMAT-14. The current SHA is visible on the PR page and adding it would make the header longer without significant benefit.

4. **How should the delta template handle the case where ALL prior findings are resolved and there are NO new findings?**
   - What we know: If all prior findings are resolved and no new ones exist, the re-review is essentially "clean."
   - What's unclear: Whether to post a delta summary showing all resolved items or to skip the summary entirely (like the silent approval path for initial reviews).
   - Recommendation: Post the delta summary showing the resolved findings. This is valuable feedback -- the maintainer needs to know that issues were addressed. The verdict would be `:green_circle: **Blockers resolved** -- Ready to merge`. Only skip the summary if there were zero prior findings AND zero new findings (which would not trigger the delta template path at all since `priorFindings.length > 0` is required).

5. **Should the delta template include a Strengths section?**
   - What we know: The initial review template has an optional Strengths section. The delta template focuses on changes.
   - What's unclear: Whether the maintainer benefits from seeing strengths in a re-review.
   - Recommendation: Do NOT include a Strengths section in the delta template. The delta template is about what CHANGED since the last review. Adding Strengths would dilute the focus and increase the summary length. The initial review already covered strengths.

## Sources

### Primary (HIGH confidence)
- Source code: `src/lib/delta-classifier.ts` -- `classifyFindingDeltas()` function, `DeltaClassification` type, `DeltaStatus` type
- Source code: `src/lib/delta-classifier.test.ts` -- 7 test cases covering new, resolved, still-open, mixed scenarios
- Source code: `src/handlers/review.ts` -- delta classification invocation (lines 1323-1345), incremental diff computation (lines 1022-1039), prior finding context (lines 1093-1110), prompt builder call (lines 1191-1225), finding extraction (lines 1257-1267)
- Source code: `src/execution/review-prompt.ts` -- `buildReviewPrompt()`, `buildIncrementalReviewSection()`, `buildVerdictLogicSection()`, current summary template (lines 944-1025)
- Source code: `src/execution/mcp/comment-server.ts` -- `sanitizeKodiaiReviewSummary()` with five-section validation, verdict cross-check
- Source code: `src/lib/incremental-diff.ts` -- `computeIncrementalDiff()`, `IncrementalDiffResult` type
- Source code: `src/lib/finding-dedup.ts` -- `buildPriorFindingContext()`, `shouldSuppressFinding()`
- Source code: `src/knowledge/types.ts` -- `PriorFinding`, `KnowledgeStore.getPriorReviewFindings()`
- Source code: `src/handlers/review-idempotency.ts` -- `buildReviewOutputMarker()`, `buildReviewOutputKey()`

### Secondary (MEDIUM confidence)
- Phase 34 research: `.planning/phases/34-structured-review-template/34-RESEARCH.md` -- established the output flow architecture (two-comment model, prompt + sanitizer pattern)
- Phase 36 research: `.planning/phases/36-verdict-and-merge-confidence/36-RESEARCH.md` -- established verdict logic section pattern, blocker counting, sanitizer cross-check approach
- Roadmap: `.planning/ROADMAP.md` -- Phase 38 description, success criteria, dependency on Phase 34 and 36

### Tertiary (LOW confidence)
- None -- all findings are from direct source code analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, all changes are in existing files
- Architecture: HIGH -- the delta classification infrastructure is fully understood from source code; the prompt+sanitizer pattern is well-established from Phases 34-37; the data flow gap (delta classification not reaching the prompt) is clearly identified
- Pitfalls: HIGH -- identified from direct analysis of the timing issue (prompt runs before execution), sanitizer discrimination, variable scoping, and template interaction
- Code examples: HIGH -- based on actual current code structure, function signatures, and data types

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable -- no external dependencies to go stale)
