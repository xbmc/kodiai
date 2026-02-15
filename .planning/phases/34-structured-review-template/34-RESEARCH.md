# Phase 34: Structured Review Template - Research

**Researched:** 2026-02-13
**Domain:** PR review output formatting / prompt engineering / GitHub Markdown rendering
**Confidence:** HIGH

## Summary

Phase 34 introduces a predictable, scannable structure for the initial PR review summary comment. The current codebase has two distinct output surfaces that must be coordinated: (1) a Claude-generated "Kodiai Review Summary" comment posted via `mcp__github_comment__create_comment`, and (2) a deterministic "Review Details" comment produced by `formatReviewDetailsSummary()` in `review.ts`. The new template adds five ordered sections to the summary comment (What Changed, Strengths, Observations, Suggestions, Verdict) and restructures the prompt and sanitizer to enforce this format.

The implementation is self-contained within the existing codebase -- no new libraries are needed. The core work is: (a) rewrite the summary comment prompt instructions in `review-prompt.ts`, (b) update the `sanitizeKodiaiReviewSummary()` validator in `comment-server.ts` to enforce the new five-section structure, (c) add a `buildReviewedCategoriesChecklist()` helper that uses `DiffAnalysis.filesByCategory` to generate the FORMAT-02 progress checklist, and (d) update tests for all three requirements.

**Primary recommendation:** Modify the existing review prompt and sanitizer to enforce the new five-section template. The diff analysis infrastructure already provides all the data needed for the "Reviewed" checklist (FORMAT-02). No new dependencies or architectural changes are required.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | -- | -- | All existing deps are sufficient |

This phase requires zero new dependencies. The implementation uses:

- `src/execution/review-prompt.ts` -- prompt construction (already exists)
- `src/execution/mcp/comment-server.ts` -- sanitizer/validator (already exists)
- `src/execution/diff-analysis.ts` -- file category data for FORMAT-02 (already exists)
- `src/lib/formatting.ts` -- `wrapInDetails()` utility (already exists)

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | existing | Schema validation in config | If adding any new config fields |
| bun:test | existing | Test framework | For all new tests |

### Alternatives Considered

None -- this phase is purely about prompt + sanitizer + formatting changes within the existing architecture.

## Architecture Patterns

### Current Output Flow (Must Understand)

The review handler produces TWO separate GitHub comments on a PR:

```
1. SUMMARY COMMENT (Claude-generated, optional):
   - Built by Claude following prompt instructions in buildReviewPrompt()
   - Posted via mcp__github_comment__create_comment tool
   - Validated by sanitizeKodiaiReviewSummary() in comment-server.ts
   - Currently: <details> wrapped with severity headings, issues-only
   - Only posted when issues are found

2. REVIEW DETAILS COMMENT (deterministic, always posted):
   - Built by formatReviewDetailsSummary() in review.ts
   - Posted via upsertReviewDetailsComment() after execution
   - Contains: files reviewed, lines, severity counts, suppressions, time-saved
   - Also: delta summary, provenance, low-confidence findings
```

**Key insight:** The summary comment (item 1) is the target for FORMAT-01 restructuring. The Review Details comment (item 2) already has structured metrics and should remain separate.

### Current Summary Comment Structure

```markdown
<details>
<summary>Kodiai Review Summary</summary>

Critical
path/to/file.ts (123, 456): <issue title>
<1-3 sentences explaining impact>

Medium
path/to/file.ts (789): <issue title>
<1-3 sentences explaining impact>

</details>
```

### New Template Structure (FORMAT-01)

```markdown
<details>
<summary>Kodiai Review Summary</summary>

## What Changed
<brief summary of PR intent from title/description>

Reviewed: core logic, error handling, tests

## Strengths
- :white_check_mark: Null checks added for all nullable returns
- :white_check_mark: Test coverage maintained at 87%

## Observations

### Critical
path/to/file.ts (123, 456): <issue title>
<1-3 sentences explaining impact>

### Major
path/to/file.ts (789): <issue title>
<1-3 sentences explaining impact>

## Suggestions
- Consider extracting the retry logic into a shared utility
- The error message could be more descriptive for debugging

## Verdict
:yellow_circle: **Needs changes** -- 1 critical and 2 major issues require attention before merge.

</details>
```

### Pattern 1: Prompt-Driven Template Enforcement

**What:** The template structure is enforced at two layers: (a) prompt instructions tell Claude exactly what sections to produce and in what order, and (b) `sanitizeKodiaiReviewSummary()` validates the output server-side before posting.

**When to use:** Always -- this is the existing pattern for all review output.

**Implementation approach:**

```
review-prompt.ts:
  buildReviewPrompt() -> "## Summary comment" section
  - Replace current issues-only format with five-section template
  - Include example for each section
  - Specify exact section ordering

comment-server.ts:
  sanitizeKodiaiReviewSummary() -> validation
  - Validate five sections exist in order
  - Strip forbidden content (extra headings, prose outside sections)
  - Allow graceful degradation (missing Strengths/Suggestions is OK)
```

### Pattern 2: Reviewed Categories Checklist (FORMAT-02)

**What:** The "What Changed" section includes a checklist showing which file categories the bot reviewed. This data already exists in `DiffAnalysis.filesByCategory`.

**When to use:** Always -- this is the FORMAT-02 requirement.

**Data flow:**

```
analyzeDiff() -> DiffAnalysis.filesByCategory
  {
    source: ["src/index.ts"],     -> "core logic"
    test: ["src/index.test.ts"],  -> "tests"
    config: ["package.json"],     -> "config"
    docs: [],                     -> omitted (no files)
    infra: [],                    -> omitted (no files)
  }

Mapped to review-friendly labels:
  source  -> "core logic"
  test    -> "tests"
  config  -> "config"
  docs    -> "docs"
  infra   -> "infrastructure"

Output: "Reviewed: core logic, tests, config"
```

**Where to build this:** New helper function `buildReviewedCategoriesLine()` in `review-prompt.ts`. This function takes `DiffAnalysis.filesByCategory` and returns a formatted string like `"Reviewed: core logic, error handling, tests"`.

The error handling category is NOT currently in `filesByCategory` -- it would require content analysis of the diff. For phase 34, use only the file-category-based checklist. Error handling detection can be added in a later phase.

### Pattern 3: Checkmark Formatting for Strengths (FORMAT-05)

**What:** Use Unicode checkmark formatting in the Strengths section.

**GitHub rendering note:** GitHub Markdown renders `:white_check_mark:` as a green checkmark emoji. Alternatively, use the Unicode character directly: `\u2705`. Both render identically in GitHub comments.

**Example output:**
```markdown
## Strengths
- :white_check_mark: Null checks added for all nullable returns
- :white_check_mark: Test coverage maintained at 87%
- :white_check_mark: Breaking changes properly documented in PR description
```

**Prompt instruction:** Tell Claude to prefix each strength with `:white_check_mark:` (not a raw checkbox `- [ ]` which renders as an interactive checkbox in GitHub).

### Pattern 4: Verdict Section

**What:** Explicit merge recommendation at the end.

**Verdict vocabulary (prompt-specified):**

| Verdict | Emoji | When |
|---------|-------|------|
| Approve | :green_circle: | Zero issues found |
| Approve with notes | :green_circle: | Only minor suggestions, no blocking issues |
| Needs changes | :yellow_circle: | Has major or medium issues |
| Block | :red_circle: | Has critical issues |

**Key constraint:** The verdict is purely informational -- it does NOT affect the auto-approve logic. The auto-approve decision is made deterministically by `review.ts` based on whether Claude published any output. The verdict is for human readability only.

### Anti-Patterns to Avoid

- **Anti-pattern: Merging summary comment into Review Details comment.** These are separate concerns. The summary comment is Claude-generated and contextual; the Review Details comment is deterministic and quantitative. Keep them separate.

- **Anti-pattern: Making the template rigid with no graceful degradation.** If Claude produces a review with no strengths (e.g., a PR that's entirely broken), the Strengths section should be omittable. Same for Suggestions. What Changed, Observations, and Verdict should always be present.

- **Anti-pattern: Posting the summary comment when no issues exist.** The current behavior (no summary when no issues) should be preserved. The new template adds Strengths and Suggestions, but these should only appear when issues also exist. If the review is clean, the auto-approve path fires with no summary.

- **Anti-pattern: Using interactive checkboxes `- [ ]` in Strengths.** GitHub renders these as clickable checkboxes that can be toggled. Use `:white_check_mark:` emoji instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File category labels | Custom category detection | `DiffAnalysis.filesByCategory` | Already computed by `analyzeDiff()` |
| Diff metrics for checklist | Parse diff again | `DiffAnalysis.metrics` | Already computed |
| Comment posting | Custom GitHub API calls | Existing MCP comment server | Already handles idempotency, markers, sanitization |
| Output validation | Regex-only validation | Extend `sanitizeKodiaiReviewSummary()` | Already handles format enforcement with structured error messages |

**Key insight:** The diff analysis infrastructure already provides everything FORMAT-02 needs. The category-to-label mapping is the only new logic required.

## Common Pitfalls

### Pitfall 1: Over-Strict Sanitizer Breaking Valid Reviews

**What goes wrong:** Making the sanitizer require ALL five sections causes valid reviews to be rejected. For example, a PR with only critical bugs may have no legitimate Strengths to list.
**Why it happens:** Copying the success criteria literally into validation rules.
**How to avoid:** Make What Changed, Observations, and Verdict mandatory. Make Strengths and Suggestions optional (but validate format when present).
**Warning signs:** `sanitizeKodiaiReviewSummary()` throwing errors on real-world reviews.

### Pitfall 2: Claude Not Following Template Consistently

**What goes wrong:** The prompt is too vague and Claude produces the template sometimes but not always, especially for edge cases (tiny PRs, massive PRs, single-file changes).
**Why it happens:** Prompt instructions lack specific examples for edge cases.
**How to avoid:** Include 2-3 complete examples in the prompt covering: (a) a PR with issues, (b) a clean PR with only strengths (this case should NOT post a summary -- handle via existing no-issue path), and (c) a critical-only PR.
**Warning signs:** Inconsistent section ordering or missing sections in test reviews.

### Pitfall 3: GitHub Markdown Rendering Surprises

**What goes wrong:** Sections don't render as expected inside `<details>` tags.
**Why it happens:** GitHub's Markdown parser requires a blank line after `<summary>` and before `</details>` for proper rendering. Headers inside `<details>` need blank lines before them.
**How to avoid:** All template examples in the prompt must include proper blank line spacing. The sanitizer should NOT strip blank lines between sections.
**Warning signs:** Headers rendering as plain text inside collapsed sections.

### Pitfall 4: Breaking the Existing Enhanced Mode

**What goes wrong:** The template changes accidentally affect enhanced mode, which currently suppresses the summary comment entirely.
**Why it happens:** The mode-conditional logic in `buildReviewPrompt()` is interleaved.
**How to avoid:** The new template applies ONLY when `mode === "standard"`. Enhanced mode should remain unchanged. Guard all template changes with the existing mode check.
**Warning signs:** Enhanced mode tests failing after changes.

### Pitfall 5: Reviewed Categories Checklist Missing Data

**What goes wrong:** The "Reviewed" checklist is empty or shows only "source" for every PR.
**Why it happens:** `DiffAnalysis` is optional in the prompt builder context; when not provided, there's no category data.
**How to avoid:** When `diffAnalysis` is not provided, omit the "Reviewed:" line entirely rather than showing empty. When it IS provided, only show categories that have > 0 files.
**Warning signs:** Every PR showing the same checklist regardless of content.

### Pitfall 6: Verdict Conflicting with Auto-Approve

**What goes wrong:** The Verdict says "Approve" but the bot didn't auto-approve (or vice versa).
**Why it happens:** The verdict is generated by Claude in the summary comment, but auto-approve is determined by the handler based on whether output was published.
**How to avoid:** The verdict is informational only. The summary comment is only posted when issues exist, so the verdict should never be "Approve" in a summary comment (because if everything was clean, no summary is posted). Document this constraint in the prompt.
**Warning signs:** Verdict showing "Approve" in a summary comment that also lists issues.

## Code Examples

### Example 1: New Summary Comment Prompt Instructions

The "## Summary comment" section in `buildReviewPrompt()` (around line 833-874 in `review-prompt.ts`) needs to be replaced. Current standard-mode instructions tell Claude to post issues-only with severity headings. The new instructions must specify the five-section template.

```typescript
// In buildReviewPrompt(), replace the standard-mode summary comment section:
lines.push(
  "",
  "## Summary comment",
  "",
  "ONLY post a summary comment if you found actionable issues to report as inline comments.",
  "",
  `If you found issues, FIRST post ONE summary comment using the \`mcp__github_comment__create_comment\` tool with issue number ${context.prNumber}. ALWAYS wrap the summary in \`<details>\` tags:`,
  "",
  "<details>",
  "<summary>Kodiai Review Summary</summary>",
  "",
  "## What Changed",
  "<1-2 sentence summary of PR intent from title and description>",
  "",
  reviewedCategoriesLine,  // e.g., "Reviewed: core logic, tests, config"
  "",
  "## Strengths",
  "- :white_check_mark: <specific verified positive>",
  "- :white_check_mark: <specific verified positive>",
  "",
  "## Observations",
  "",
  "### Critical",
  "path/to/file.ts (123, 456): <issue title>",
  "<1-3 sentences explaining impact and why it matters>",
  "",
  "### Major",
  "...",
  "",
  "## Suggestions",
  "- <optional improvement without opening debates>",
  "",
  "## Verdict",
  ":yellow_circle: **Needs changes** -- <1 sentence with issue count and recommendation>",
  "",
  "</details>",
);
```

### Example 2: Reviewed Categories Line Builder

```typescript
// New helper in review-prompt.ts
const CATEGORY_LABELS: Record<string, string> = {
  source: "core logic",
  test: "tests",
  config: "config",
  docs: "docs",
  infra: "infrastructure",
};

export function buildReviewedCategoriesLine(
  filesByCategory: Record<string, string[]>,
): string {
  const reviewed = Object.entries(filesByCategory)
    .filter(([, files]) => files.length > 0)
    .map(([category]) => CATEGORY_LABELS[category] ?? category);

  if (reviewed.length === 0) return "";
  return `Reviewed: ${reviewed.join(", ")}`;
}
```

### Example 3: Updated Sanitizer Validation

```typescript
// In sanitizeKodiaiReviewSummary(), add section order validation:
const requiredSections = ["## What Changed", "## Observations", "## Verdict"];
const optionalSections = ["## Strengths", "## Suggestions"];
const allSections = ["## What Changed", "## Strengths", "## Observations", "## Suggestions", "## Verdict"];

// Validate required sections exist
for (const section of requiredSections) {
  if (!stripped.includes(section)) {
    throw new Error(`Invalid Kodiai review summary: missing required section "${section}"`);
  }
}

// Validate section order (only for sections that are present)
const presentSections = allSections.filter(s => stripped.includes(s));
let lastIndex = -1;
for (const section of presentSections) {
  const idx = stripped.indexOf(section);
  if (idx < lastIndex) {
    throw new Error(`Invalid Kodiai review summary: sections must appear in order`);
  }
  lastIndex = idx;
}
```

### Example 4: Verdict Format Validation

```typescript
// Validate verdict line format
const verdictSection = stripped.slice(stripped.indexOf("## Verdict"));
const verdictLineRe = /^:(green_circle|yellow_circle|red_circle): \*\*[^*]+\*\* -- .+$/m;
if (!verdictLineRe.test(verdictSection)) {
  throw new Error(
    "Invalid Kodiai review summary: Verdict must use format ':emoji: **Label** -- explanation'"
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Unstructured review comments | Severity-grouped issues-only summary | v0.4-v0.5 | Reduced noise but lacked context |
| No scope visibility | Diff analysis + risk signals in prompt | Phase 27 (v0.5) | Better review focus |
| No metrics | Deterministic Review Details comment | Phase 26 (v0.5) | Quantitative transparency |

**What changes with Phase 34:**
- Issues-only summary evolves into five-section template (What Changed + Strengths + Observations + Suggestions + Verdict)
- Review scope becomes visible to humans via "Reviewed:" checklist
- Positive findings get explicit acknowledgment (Strengths section)
- Non-blocking suggestions get their own section (reduces noise in Observations)

## Open Questions

1. **Should the summary comment be posted when there are ONLY strengths and no issues?**
   - What we know: Currently, the summary is only posted when issues exist. The new template includes Strengths, which might be valuable even without issues.
   - What's unclear: Whether maintainers want a "clean review" summary or prefer the silent approval.
   - Recommendation: Keep the current behavior for Phase 34 -- only post summary when issues exist. This avoids comment noise on clean PRs. A future phase could add an optional "clean review summary" behind a config flag.

2. **Should Observations include issue numbering like `(1)` prefixes?**
   - What we know: The current format uses `path/to/file.ts (123, 456): issue title`. The `(1)` numbering was used in the mention/decision comment format, not the review summary.
   - What's unclear: Whether numbered issues help scanning.
   - Recommendation: Keep the current issue format (path + lines + title) without numbering. The severity heading grouping already provides organization.

3. **How should the "Reviewed" checklist handle language detection vs file categories?**
   - What we know: `DiffAnalysis` provides `filesByCategory` (source/test/config/docs/infra) AND `filesByLanguage` (TypeScript/Python/Go/etc).
   - What's unclear: Whether the checklist should show languages, categories, or both.
   - Recommendation: Use file categories for the checklist (core logic, tests, config, docs, infrastructure). Language info is already shown in the Language-Specific Guidance section of the prompt. Mixing both in the checklist would be redundant.

4. **How should the Verdict interact with the enhanced mode?**
   - What we know: Enhanced mode suppresses the summary comment entirely. The verdict is part of the summary comment.
   - What's unclear: Nothing really -- enhanced mode should continue to not have a summary.
   - Recommendation: The verdict (and entire template) only applies to standard mode. Enhanced mode is unchanged.

## Sources

### Primary (HIGH confidence)
- Source code: `src/execution/review-prompt.ts` -- current prompt structure, all builder functions
- Source code: `src/handlers/review.ts` -- review handler flow, `formatReviewDetailsSummary()`, finding extraction
- Source code: `src/execution/mcp/comment-server.ts` -- `sanitizeKodiaiReviewSummary()` validator
- Source code: `src/execution/diff-analysis.ts` -- `analyzeDiff()`, `DiffAnalysis` interface, `filesByCategory`
- Source code: `src/execution/config.ts` -- `RepoConfig` schema, review mode configuration
- Source code: `src/execution/review-prompt.test.ts` -- existing test patterns

### Secondary (MEDIUM confidence)
- [GitHub Docs: Collapsed sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections) -- `<details>` rendering rules
- [CodeRabbit ai-pr-reviewer prompts.ts](https://github.com/coderabbitai/ai-pr-reviewer/blob/main/src/prompts.ts) -- industry patterns for structured review output
- [GitHub collapsible section gist](https://gist.github.com/pierrejoubert73/902cc94d79424356a8d20be2b382e1ab) -- blank line requirements inside `<details>`

### Tertiary (LOW confidence)
- Web search results on AI code review bot structured output -- general industry direction confirms structured sections are best practice

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, all changes are in existing files
- Architecture: HIGH -- the current two-comment output model is well-understood from source code analysis; prompt + sanitizer pattern is established
- Pitfalls: HIGH -- identified from direct analysis of `sanitizeKodiaiReviewSummary()` error handling paths and prompt mode branching
- Code examples: HIGH -- based on actual current code structure and function signatures

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable -- no external dependencies to go stale)
