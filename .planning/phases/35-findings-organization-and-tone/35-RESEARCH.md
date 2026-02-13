# Phase 35: Findings Organization & Tone - Research

**Researched:** 2026-02-13
**Domain:** Prompt engineering for review output categorization, tone control, and PR-intent-scoped findings
**Confidence:** HIGH

## Summary

Phase 35 restructures how findings are categorized and communicated within the five-section template established by Phase 34. The core work is prompt-level: rewriting the `## Observations` section instructions to separate findings into "Impact" (real risks) and "Preference" (style nits) subsections, adding severity tags to each finding header, scoping findings to PR intent extracted from the title/description/labels, and enforcing specific language patterns that are concrete and low-drama. The sanitizer must be updated to validate the new Impact/Preference subsection structure and severity tags within Observations.

The implementation requires changes to three areas: (1) the prompt instructions in `review-prompt.ts` (new Observations subsection structure, PR-intent scoping instructions, tone/language guidelines), (2) the sanitizer in `comment-server.ts` (validate Impact/Preference subsections within Observations, validate severity tags in finding headers), and (3) the prompt builder interface to pass PR labels for intent extraction. PR title and body are already available in the prompt context; labels need to be threaded from the webhook handler through to `buildReviewPrompt()`.

**Primary recommendation:** Modify the Observations section template to use `### Impact` and `### Preference` as top-level subsections, with severity sub-headings (`#### [CRITICAL]`, `#### [MAJOR]`, etc.) nested under Impact. Add PR-intent extraction instructions and tone guidelines as new prompt sections. Update the sanitizer to enforce the new structure. Thread PR labels from the webhook handler to the prompt builder.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | -- | -- | All existing deps are sufficient |

This phase requires zero new dependencies. All changes are prompt engineering and sanitizer logic updates.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bun:test | existing | Test framework | For all new tests |
| zod | existing | Schema validation | If adding labels field to config |

### Alternatives Considered

None -- this phase is purely about prompt instructions, sanitizer rules, and data threading.

## Architecture Patterns

### Current Observations Section Structure (Phase 34 Baseline)

```markdown
## Observations

### Critical
path/to/file.ts (123, 456): <issue title>
<1-3 sentences explaining impact>

### Major
path/to/file.ts (789): <issue title>
<1-3 sentences explaining impact>

### Medium
...

### Minor
...
```

The current structure groups findings ONLY by severity. Phase 35 adds a second dimension: finding TYPE (Impact vs Preference).

### New Observations Section Structure (Phase 35 Target)

```markdown
## Observations

### Impact

[CRITICAL] path/to/file.ts (123, 456): <issue title>
<concrete condition and consequence: "causes X when Y">

[MAJOR] path/to/file.ts (789): <issue title>
<concrete condition and consequence>

### Preference

[MINOR] path/to/file.ts (101): <issue title>
<specific suggestion with low-drama language>
```

**Key structural changes from Phase 34:**
1. Severity sub-headings (`### Critical`, `### Major`, etc.) replaced by TYPE sub-headings (`### Impact`, `### Preference`)
2. Severity moves from sub-heading level to inline tags in finding headers: `[CRITICAL]`, `[MAJOR]`, `[MEDIUM]`, `[MINOR]`
3. Impact subsection contains correctness, security, and performance findings
4. Preference subsection contains style, naming, and organization suggestions

**Why this structure:** The severity-only grouping from Phase 34 doesn't distinguish between "this will crash in production" (Impact) and "this naming convention is inconsistent" (Preference). Users need to know: (a) what requires action (Impact), and (b) what's optional cleanup (Preference). The severity tag on each finding still provides granularity within each type.

### Pattern 1: Prompt-Driven Impact/Preference Classification

**What:** The prompt instructs Claude to classify each finding as Impact or Preference based on the finding's category.

**Classification rules (for the prompt):**

| Type | Categories | Severity Range |
|------|-----------|----------------|
| Impact | correctness, security, performance, error-handling, resource-management, concurrency | CRITICAL, MAJOR, MEDIUM, MINOR |
| Preference | style, naming, code organization, documentation formatting | MEDIUM, MINOR only |

**Constraint:** CRITICAL and MAJOR findings MUST always be Impact. Preference findings are capped at MEDIUM severity. This prevents inflation of style nits to blocking severity.

**Where to implement:** Add classification instructions to the `## Summary comment` section of `buildReviewPrompt()`, replacing the severity sub-heading instructions with the new Impact/Preference + severity tag instructions.

### Pattern 2: PR Intent Extraction and Scoping

**What:** The prompt extracts the PR's intent from the title, description, and labels, then scopes findings to that intent. A CI-fix PR should not receive style nits as top-level findings.

**Data available for intent extraction:**

| Data Source | Currently Available in Prompt | Notes |
|---|---|---|
| PR title | YES -- passed via `context.prTitle`, shown as `Title:` in prompt | Truncated to 200 chars |
| PR description/body | YES -- passed via `context.prBody`, shown as `PR description:` in prompt | Truncated to 2000 chars |
| PR labels | NO -- not passed to `buildReviewPrompt()` | Available in webhook payload as `pr.labels` |
| Branch name | YES -- shown as `Branches: head -> base` in prompt | Contains convention hints like `fix/`, `feat/`, `ci/` |

**Implementation approach for PR labels:**

1. Add `prLabels?: string[]` to the `buildReviewPrompt()` context interface
2. In the handler (`review.ts`), extract labels from the PR payload: `pr.labels?.map((l: { name: string }) => l.name) ?? []`
3. Pass labels to `buildReviewPrompt()` as a new parameter
4. In the prompt builder, if labels are present, add them after the PR description: `Labels: bug, ci-fix, performance`
5. Add intent-scoping instructions to the prompt that reference the title, description, labels, and branch name

**Intent-scoping prompt instructions:**

```
## PR Intent Scoping

Before generating findings, identify the PR's primary intent from:
- PR title and description
- PR labels (if present)
- Branch name conventions (fix/, feat/, ci/, refactor/, perf/, docs/)

Scope your findings to the PR's intent:
- CI/test fix PR: Focus on test reliability and correctness. Style nits go in Preference only.
- Performance PR: Focus on benchmarks, resource usage, algorithmic complexity. Documentation nits go in Preference only.
- Refactoring PR: Focus on behavior preservation and backward compatibility. Note "preserves existing behavior" for safe refactors.
- Bug fix PR: Focus on the fix correctness and edge cases. Unrelated style issues go in Preference only.
- Feature PR: Full review scope applies.

Do NOT judge a narrowly-scoped PR against an imagined ideal version of the code.
Only flag issues outside the PR's intent if they are CRITICAL severity.
```

### Pattern 3: Tone and Language Guidelines

**What:** Enforce specific, low-drama language patterns in findings. Replace hedged possibilities with concrete conditions and consequences.

**Prompt instructions (to add as a new section):**

```
## Finding Language Guidelines

Use specific, concrete language in all findings:

DO:
- "This causes [specific issue] when [specific condition]"
- "[CRITICAL] Null pointer dereference when `user` is undefined at line 45"
- "Optional: Extract `retryWithBackoff()` to reduce duplication (3 call sites)"
- "preserves existing behavior" (for safe refactors)
- "backward compatible" (for API changes that don't break callers)
- "minimal impact" (for low-risk changes with small blast radius)

DO NOT:
- "This could potentially maybe cause issues"
- "Consider refactoring this"
- "This might have problems"
- "There may be an issue here"
- "This is concerning"

Every finding must answer: WHAT happens, WHEN does it happen, and WHY does it matter.
For Preference findings, prefix with "Optional:" to signal they are non-blocking.
```

### Pattern 4: Stabilizing Language for Low-Risk Changes

**What:** When a change is low-risk (refactor, backward-compatible API change, minimal-impact edit), the review should explicitly call this out with stabilizing language.

**Implementation:** This is purely prompt-instructional. Add language to the prompt that tells Claude when to use stabilizing phrases:

- "preserves existing behavior" -- use when a refactor doesn't change observable output
- "backward compatible" -- use when an API change doesn't break existing callers
- "minimal impact" -- use when the change has a small blast radius (few callers, limited scope)

These phrases appear in the Strengths section or as annotations on Preference findings. They are NOT new fields or data -- they are tone guidelines.

### Pattern 5: Sanitizer Updates for New Structure

**What:** Update `sanitizeKodiaiReviewSummary()` to validate the new Observations subsection structure.

**Changes from Phase 34 sanitizer:**

| Validation | Phase 34 | Phase 35 |
|---|---|---|
| Observations sub-headings | `### Critical`, `### Major`, `### Medium`, `### Minor` | `### Impact`, `### Preference` |
| Severity in findings | Implicit (under severity heading) | Explicit tag in header: `[CRITICAL]`, `[MAJOR]`, `[MEDIUM]`, `[MINOR]` |
| Finding line format | `path (lines): title` | `[SEVERITY] path (lines): title` |
| Required sub-headings | At least one severity sub-heading | `### Impact` required; `### Preference` optional |
| Severity cap enforcement | None | Preference findings cannot be CRITICAL or MAJOR (sanitizer warning, not error) |

**Updated issue line regex:**

Current (Phase 34): `/^(.+?) \((?:\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*)\): (.+)$/`

New (Phase 35): `/^\[(CRITICAL|MAJOR|MEDIUM|MINOR)\] (.+?) \((?:\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*)\): (.+)$/`

The severity tag prefix is now part of the issue line format.

### Anti-Patterns to Avoid

- **Anti-pattern: Making Impact/Preference determination in the sanitizer.** The sanitizer validates STRUCTURE (are the subsections present, are severity tags formatted correctly). It does NOT validate CLASSIFICATION (whether a finding belongs in Impact vs Preference). Classification is prompt-driven and relies on Claude's judgment.

- **Anti-pattern: Enforcing severity caps in the sanitizer as hard errors.** If Claude puts a MAJOR finding in Preference, the sanitizer should warn but not reject. The prompt should prevent this, but strict enforcement would break valid edge cases.

- **Anti-pattern: Adding PR labels to the prompt when none exist.** If the PR has no labels, omit the `Labels:` line entirely. Don't show `Labels: (none)`.

- **Anti-pattern: Breaking the existing noise suppression rules.** Phase 35 adds PR-intent scoping, but the existing noise suppression rules (no style-only issues, no cosmetic preferences, etc.) remain active. The intent-scoping instructions SUPPLEMENT the noise rules -- they don't replace them.

- **Anti-pattern: Changing the inline comment format.** Phase 35 changes the SUMMARY comment Observations section. The inline comments posted via `mcp__github_inline_comment__create_inline_comment` continue to use the existing format (`[SEVERITY] title` in standard mode, YAML block in enhanced mode). The severity tag in the summary's finding headers is a separate concern from inline comment format.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PR intent classification | NLP/keyword extraction library | Prompt instructions that reference existing PR context | Claude can interpret title/description/labels/branch semantics natively |
| Finding severity assignment | Deterministic severity classifier | Prompt-driven classification with sanitizer structure validation | Severity depends on context (code purpose, surrounding logic) |
| Impact vs Preference split | Category-to-type mapping function | Prompt instructions defining the classification criteria | The boundary is fuzzy and depends on PR context |

**Key insight:** All of Phase 35's requirements are prompt engineering + sanitizer structure changes. There is no new logic, data model, or algorithmic work. The "intelligence" is in how Claude is instructed to organize and articulate findings.

## Common Pitfalls

### Pitfall 1: Sanitizer Breaking Existing Valid Reviews

**What goes wrong:** Changing the Observations subsection structure from `### Critical` etc. to `### Impact` / `### Preference` breaks all existing review output that was generated under Phase 34's template.
**Why it happens:** The sanitizer validates structure, and the structure is changing.
**How to avoid:** The transition needs to be handled in the prompt first (so Claude starts generating the new format), then the sanitizer is updated. Both changes should ship in the same plan wave so there's no window where the prompt generates one format and the sanitizer expects another. The sanitizer should accept BOTH formats during a transition period, OR both changes must be deployed atomically.
**Warning signs:** Sanitizer rejection errors in the logs immediately after deployment.

### Pitfall 2: Claude Ignoring Impact/Preference Split

**What goes wrong:** Claude puts all findings under `### Impact` and leaves `### Preference` empty, defeating the purpose of the split.
**Why it happens:** The prompt instructions are too vague about what belongs in each section, or Claude's safety training causes it to elevate everything to "impact" out of caution.
**How to avoid:** Provide explicit classification examples in the prompt. Include concrete examples of Preference findings (naming, import ordering, variable naming) and make it clear that not everything is a risk. Also: the existing noise suppression rules already filter out many preference-type findings -- the remaining ones that DO pass should be genuinely worth mentioning.
**Warning signs:** Every review has an empty Preference section.

### Pitfall 3: Severity Tags Breaking Issue Line Parsing

**What goes wrong:** The updated issue line regex with `[SEVERITY]` prefix doesn't match Claude's output because Claude formats the tag differently (e.g., `**[CRITICAL]**` with bold, or `CRITICAL:` without brackets).
**Why it happens:** Claude has its own formatting tendencies that may override prompt instructions.
**How to avoid:** Make the regex flexible for common variations. The prompt should show EXACT examples with brackets. The sanitizer should strip bold markers before matching.
**Warning signs:** Valid findings being rejected by the sanitizer.

### Pitfall 4: PR Intent Scoping Silencing Real Issues

**What goes wrong:** A CI-fix PR has a real security vulnerability in the changed code, but the intent-scoping suppresses it because "this PR is about CI, not security."
**Why it happens:** Overly aggressive intent-scoping rules.
**How to avoid:** The intent-scoping instructions include an escape hatch: "Only flag issues outside the PR's intent if they are CRITICAL severity." This ensures CRITICAL findings are NEVER scoped out. Additionally, the scoping only affects WHERE findings appear (Impact vs Preference) and the emphasis in the review -- it doesn't suppress findings entirely.
**Warning signs:** CRITICAL findings appearing in Preference section.

### Pitfall 5: PR Labels Field Not Available in All Webhook Events

**What goes wrong:** `pr.labels` is undefined or an empty array for certain webhook event types.
**Why it happens:** The `PullRequestSynchronizeEvent` type may have different label availability than `PullRequestOpenedEvent`.
**How to avoid:** Always provide a fallback: `pr.labels?.map((l: { name: string }) => l.name) ?? []`. Treat labels as optional enhancement. Intent extraction still works from title + description + branch name.
**Warning signs:** TypeScript type errors when accessing `pr.labels`.

### Pitfall 6: Prompt Size Inflation

**What goes wrong:** Adding PR-intent-scoping instructions, tone guidelines, stabilizing language rules, and classification examples significantly increases prompt token count.
**Why it happens:** Each requirement (FORMAT-06 through FORMAT-18) adds instructional text.
**How to avoid:** Keep instructions concise. Use examples sparingly (2-3 per concept, not exhaustive lists). The prompt is already 800+ lines; the additional instructions should add no more than ~80-100 lines total.
**Warning signs:** Token budget warnings in logs, increased review latency.

## Code Examples

### Example 1: Updated Prompt Observations Template

```typescript
// In buildReviewPrompt(), replace the Observations section instructions:
"## Observations",
"",
"### Impact",
"<findings about correctness, security, performance, error handling>",
"",
"[CRITICAL] path/to/file.ts (123, 456): <issue title>",
"<concrete condition and consequence: 'causes X when Y'>",
"",
"[MAJOR] path/to/file.ts (789): <issue title>",
"<concrete condition and consequence>",
"",
"### Preference",
"<optional findings about style, naming, code organization>",
"",
"[MINOR] path/to/file.ts (101): <issue title>",
"Optional: <specific suggestion with actionable language>",
```

### Example 2: PR Labels Threading

```typescript
// In review.ts handler, extract labels:
const prLabels = (pr.labels as Array<{ name: string }> | undefined)
  ?.map((l) => l.name) ?? [];

// Pass to buildReviewPrompt:
const reviewPrompt = buildReviewPrompt({
  ...existingContext,
  prLabels,
});
```

```typescript
// In buildReviewPrompt(), add labels to context header:
if (context.prLabels && context.prLabels.length > 0) {
  lines.push(`Labels: ${context.prLabels.join(", ")}`);
}
```

### Example 3: Updated Sanitizer Regex for Severity-Tagged Findings

```typescript
// Updated issue line regex with severity tag prefix
const severityTaggedIssueLineRe = new RegExp(
  `^\\[(CRITICAL|MAJOR|MEDIUM|MINOR)\\] (.+?) \\((?:${lineSpec})\\): (.+)$`
);

// Valid subsections under ## Observations
const validObservationsSubsections = new Set(["### Impact", "### Preference"]);
```

### Example 4: PR Intent Scoping Prompt Section

```typescript
function buildPrIntentScopingSection(
  prTitle: string,
  prLabels: string[],
  headBranch: string,
): string {
  const lines = [
    "## PR Intent Scoping",
    "",
    "Before classifying findings, identify this PR's primary intent from:",
    `- Title: "${prTitle}"`,
  ];

  if (prLabels.length > 0) {
    lines.push(`- Labels: ${prLabels.join(", ")}`);
  }

  lines.push(
    `- Branch: ${headBranch}`,
    "",
    "Scope findings to the PR's stated intent:",
    "- CI/test fix: Focus findings on test reliability and correctness. Style issues go to Preference.",
    "- Performance: Focus on resource usage, complexity. Documentation issues go to Preference.",
    "- Refactor: Focus on behavior preservation. Note 'preserves existing behavior' for safe changes.",
    "- Bug fix: Focus on fix correctness, edge cases. Unrelated style goes to Preference.",
    "- Feature: Full review scope -- all categories apply.",
    "",
    "Findings outside the PR's intent belong in Preference unless CRITICAL severity.",
    "Do NOT judge a narrowly-scoped PR against an imagined ideal version of the code.",
  );

  return lines.join("\n");
}
```

### Example 5: Tone Guidelines Prompt Section

```typescript
function buildToneGuidelinesSection(): string {
  return [
    "## Finding Language Guidelines",
    "",
    "Every finding must be specific about WHAT happens, WHEN it happens, and WHY it matters.",
    "",
    "Use concrete language:",
    '- "causes [specific issue] when [specific condition]"',
    '- "[CRITICAL] Null pointer dereference when `user` is undefined"',
    '- "Optional: Extract `retryWithBackoff()` to reduce duplication"',
    "",
    "Do NOT use hedged or vague language:",
    '- "could potentially cause issues"',
    '- "consider refactoring"',
    '- "this might have problems"',
    '- "there may be an issue here"',
    "",
    "For low-risk changes, use stabilizing language:",
    '- "preserves existing behavior" -- for refactors that don\'t change output',
    '- "backward compatible" -- for API changes that don\'t break callers',
    '- "minimal impact" -- for changes with small blast radius',
    "",
    "Prefix Preference findings with 'Optional:' to signal they are non-blocking.",
  ].join("\n");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Issues-only summary | Five-section template (Phase 34) | Phase 34 (current branch) | Structured output |
| Severity-only grouping | Severity sub-headings in Observations | Phase 34 | Findings grouped by severity |
| No intent scoping | Noise suppression rules only | Phase 26 | Reduces false positives |
| Generic review language | No specific tone guidelines | -- | Inconsistent finding language |

**What changes with Phase 35:**
- Severity grouping evolves into Impact/Preference split with inline severity tags
- PR intent becomes an explicit input to finding scope (title + description + labels + branch)
- Finding language is constrained to concrete conditions/consequences
- Low-risk changes get explicit stabilizing callouts

## Open Questions

1. **Should the sanitizer reject CRITICAL/MAJOR findings in the Preference section?**
   - What we know: The prompt instructs that Preference is capped at MEDIUM severity. CRITICAL/MAJOR should always be Impact.
   - What's unclear: Whether to enforce this as a hard error (reject the review) or soft warning (log but allow).
   - Recommendation: Make it a soft check -- log a warning but allow the review to pass. Hard rejection risks losing a valid review. The prompt should prevent this case; the sanitizer is defense-in-depth.

2. **Should we maintain backward compatibility with the Phase 34 severity sub-heading format?**
   - What we know: Phase 34 just shipped. The sanitizer currently expects `### Critical`, `### Major`, etc.
   - What's unclear: Whether there will be a production window between Phase 34 deployment and Phase 35 deployment.
   - Recommendation: Since both phases are on the same branch and will deploy together, no backward compatibility is needed. Replace the severity sub-headings format entirely. If there's a production gap, the sanitizer should temporarily accept both formats.

3. **Are PR labels reliably typed in @octokit/webhooks-types?**
   - What we know: The `PullRequestOpenedEvent` type includes `pull_request.labels` as an array of label objects. Other PR event types should also include labels.
   - What's unclear: Whether all PR event types have the same label structure.
   - Recommendation: Type-guard the label extraction with a runtime check and default to empty array. This is already the pattern used for optional fields throughout the handler.

4. **How should the Phase 34 -> Phase 35 sanitizer transition work for the Observations sub-headings?**
   - What we know: Phase 34 validates `### Critical` etc. Phase 35 validates `### Impact` / `### Preference`.
   - What's unclear: Whether both can exist in the same sanitizer.
   - Recommendation: Plan 01 updates the prompt to generate the new format. Plan 02 updates the sanitizer to validate the new format. Both are deployed atomically (same branch). The sanitizer should replace the severity sub-heading validation with Impact/Preference validation, not support both simultaneously.

## Sources

### Primary (HIGH confidence)
- Source code: `src/execution/review-prompt.ts` -- current prompt structure, five-section template from Phase 34, severity classification guidelines, noise suppression rules
- Source code: `src/execution/mcp/comment-server.ts` -- current `sanitizeKodiaiReviewSummary()` with five-section validation, issue line regex, severity sub-heading checks
- Source code: `src/handlers/review.ts` -- review handler showing PR data flow, `pr.title`, `pr.body`, `pr.user.login`, `pr.head.ref`; PR labels available but not passed through
- Source code: `src/execution/diff-analysis.ts` -- `DiffAnalysis` interface, file category classification
- Source code: `src/execution/config.ts` -- `RepoConfig` schema, review mode and severity configuration
- Source code: `src/execution/review-prompt.test.ts` -- 65+ existing test patterns for prompt builder
- Source code: `src/execution/mcp/comment-server.test.ts` -- 19 existing sanitizer test cases with `buildTestSummary()` helper

### Secondary (MEDIUM confidence)
- Phase 34 research and summaries: `.planning/phases/34-structured-review-template/34-RESEARCH.md`, `34-01-SUMMARY.md`, `34-02-SUMMARY.md` -- established patterns, key decisions, and anti-patterns from the foundation phase
- Requirements: `.planning/REQUIREMENTS.md` -- FORMAT-06 through FORMAT-08, FORMAT-17, FORMAT-18 definitions

### Tertiary (LOW confidence)
- None -- all findings are from direct source code analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, all changes are in existing files
- Architecture: HIGH -- the Phase 34 foundation is well-understood; the changes are incremental modifications to existing prompt and sanitizer logic
- Pitfalls: HIGH -- identified from direct analysis of the current sanitizer behavior, prompt structure, and data flow through the handler
- Code examples: HIGH -- based on actual current code patterns and function signatures

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable -- no external dependencies to go stale)
