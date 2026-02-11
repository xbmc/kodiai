# Phase 26: Review Mode & Severity Control - Research

**Researched:** 2026-02-11
**Domain:** Configurable AI code review output with structured severity tagging, noise suppression, and comment cap enforcement
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Review Output Structure

**Enhanced mode format:**
- Each inline comment uses structured header with body format
- YAML frontmatter at the top of each comment with required fields:
  - `severity`: critical | major | medium | minor
  - `category`: security | correctness | performance | style | documentation
  - `suggested_action`: fix_required | review_recommended | consider_refactor
  - `related_docs_url`: link to relevant docs (optional, include when applicable)
- YAML frontmatter followed by blank line, then finding details
- No top-level summary comment — each inline comment stands alone

**Standard mode format:**
- Light structure: add severity prefix only (e.g., "[MAJOR]")
- Preserves simpler format for backward compatibility while adding basic structure

**Machine parseability:**
- Enhanced mode uses strict YAML frontmatter for programmatic consumption
- Users building tooling can parse severity/category/suggested_action reliably

#### Severity Classification Approach

**Hybrid model: deterministic rules + LLM fallback**
- Known patterns get deterministic severity assignments
- Ambiguous cases defer to LLM with context-aware guidelines

**Four severity levels:**
- CRITICAL: must fix (security vulnerabilities, critical bugs)
- MAJOR: should fix (important bugs, error handling issues)
- MEDIUM: consider fixing (moderate issues, some maintainability concerns)
- MINOR: nice-to-have (code smells, minor improvements)

**Deterministic severity rules for:**
- Security patterns: SQL injection, XSS, auth bypass, secrets exposure -> CRITICAL
- Critical bugs: NPE/null pointer, divide by zero, infinite loop -> CRITICAL or MAJOR
- Common code smells: unused variables, duplicate code, magic numbers -> MINOR
- Error handling issues: unhandled exceptions, swallowed errors -> MAJOR or MEDIUM (context-dependent)

**Path-aware severity:**
- Same issue type has different severity based on file path
- Test files, config files, documentation, vs production source code context matters
- Example: unused variable in test file = lower severity than in production code

#### Comment Limit Behavior

**7-comment cap:**
- Maximum 7 inline comments per PR review (from success criterion #4)
- Note: User questioned this limit -- capture concern for discussion during planning

**Filtering precedence:**
- When more than 7 issues found, prioritization logic TBD
- User indicated concern about fixed limit, wants flexibility discussed
- Communication of omitted findings: TBD

#### Focus Area Targeting

**Category taxonomy:**
- Available categories: security, correctness, performance, style, documentation
- Users specify `review.focusAreas: [security, correctness]` in config

**Filtering behavior:**
- `focusAreas` filters by category (include list)
- `ignoredAreas` explicitly excludes categories (exclude list)
- Both can be used together for fine-grained control

**Interaction with noise suppression:**
- Independent mechanisms -- both apply
- focusAreas filters by category
- Noise suppression removes style/trivial issues within selected categories
- Style/trivial renamings always suppressed per success criterion #5

### Claude's Discretion

- Exact YAML frontmatter rendering format (choose what renders best in GitHub UI)
- Whether standard mode gets YAML frontmatter with just severity, or text prefix only
- Whether to add `review.format: plain` config option for opting out of structured output
- Comment prioritization strategy when hitting 7-comment limit (severity-first vs diversity vs file-spread)
- How to communicate omitted issues when more than 7 findings exist
- Whether comment limit should be configurable via `review.maxComments` or fixed at 7
- Whether minLevel filtering happens before or after comment limit
- How strictly to suppress non-focus categories (strict only vs critical exception vs soft de-prioritization)

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope

</user_constraints>

## Summary

Phase 26 adds configurable review strictness to Kodiai by extending the `.kodiai.yml` review config schema, modifying the review prompt builder to emit mode-aware instructions, and adjusting comment format validation. The implementation surface is narrow: new Zod schema fields in `src/execution/config.ts`, enriched prompt sections in `src/execution/review-prompt.ts`, and updated validation in `src/execution/mcp/comment-server.ts`. No new files are strictly required -- the entire phase modifies existing modules.

The core design principle is **prompt-driven behavior**: all review mode logic, severity classification guidance, focus area filtering, and noise suppression rules are communicated to Claude via the system prompt. The executor, MCP servers, and job pipeline remain unchanged. This follows the architecture pattern already established in the codebase where `buildReviewPrompt()` is the single source of truth for review behavior, and the comment server provides output format validation as a guardrail.

The highest-risk area is YAML frontmatter rendering in GitHub PR inline comments. GitHub comments render `---` as horizontal rules (not as YAML frontmatter delimiters), so the "YAML frontmatter" format for enhanced mode needs to use fenced code blocks (` ```yaml `) rather than raw `---` delimiters. This is a critical rendering detail that affects the locked "machine-parseable YAML frontmatter" decision.

**Primary recommendation:** Implement as two plans: (1) Config schema extension + prompt enrichment with severity/mode/focus/noise-suppression instructions, and (2) Enhanced mode output format + comment validation + comment cap enforcement. Keep all intelligence in the prompt -- no post-processing filters, no pre-processing AI calls.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | ^4.3.6 | Config schema validation for new review fields | Already used for all `.kodiai.yml` parsing in `src/execution/config.ts` |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.37 | Executes review via `query()` | Already used -- no changes needed to executor |
| `js-yaml` | ^4.1.1 | YAML config parsing | Already used in `loadRepoConfig()` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All requirements use existing dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Prompt-level severity filtering | Post-processing filter on MCP output | Post-processing wastes tokens generating findings that get discarded; breaks summary/inline consistency |
| Fenced YAML code block in comments | Raw `---` YAML frontmatter delimiters | Raw `---` renders as horizontal rules in GitHub comments -- fenced code block is the only viable option |
| Comment count via prompt instruction | MCP-level counting/blocking | MCP blocking would require state tracking across tool calls; prompt instruction is simpler and Claude reliably self-limits when told a max count |

**Installation:**
```bash
# No new packages needed -- all requirements use existing dependencies
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── execution/
│   ├── config.ts              # MODIFIED: new review.mode, review.severity, review.focusAreas, review.ignoredAreas fields
│   ├── config.test.ts         # MODIFIED: tests for new config fields
│   ├── review-prompt.ts       # MODIFIED: mode-aware prompt sections, severity guidelines, focus filtering, noise suppression
│   └── mcp/
│       ├── comment-server.ts  # MODIFIED: update summary validation for enhanced mode (no summary comment), validate severity tags
│       └── inline-review-server.ts  # POTENTIALLY MODIFIED: validate enhanced mode comment format
├── handlers/
│   └── review.ts              # MODIFIED: pass new config fields to buildReviewPrompt()
└── (all other files unchanged)
```

### Pattern 1: Config-Driven Prompt Sections

**What:** New config fields (`review.mode`, `review.severity.minLevel`, `review.focusAreas`, etc.) translate to prompt text sections inserted into the review prompt. The config value selects a prompt template -- no code branching based on mode.

**When to use:** Any time configurable review behavior is needed.

**Why:** The existing architecture routes all intelligence through a single `query()` call via `buildReviewPrompt()`. Adding code branches for different modes creates testing complexity. String templates are simpler, more testable, and follow the existing pattern.

**Example:**
```typescript
// In review-prompt.ts -- mode-specific instructions are prompt text, not code branches
function buildModeInstructions(mode: "standard" | "enhanced"): string {
  if (mode === "enhanced") {
    return ENHANCED_MODE_INSTRUCTIONS; // YAML frontmatter format, structured metadata
  }
  return STANDARD_MODE_INSTRUCTIONS; // "[SEVERITY]" prefix format
}

function buildSeverityFilterInstructions(minLevel: string): string {
  const levels = ["critical", "major", "medium", "minor"];
  const activeIndex = levels.indexOf(minLevel);
  const activeLevels = levels.slice(0, activeIndex + 1);
  return `Only report findings at these severity levels: ${activeLevels.join(", ")}. Do NOT report findings below ${minLevel}.`;
}
```

### Pattern 2: Zod Schema Extension with Section-Level Fallback

**What:** New config fields are added as optional fields with defaults inside the existing `reviewSchema` Zod definition. The section-level fallback parsing in `loadRepoConfig()` already handles individual section failures gracefully.

**When to use:** Adding any new config field.

**Why:** The existing config parser has a two-pass architecture: full-schema parse first, section-level fallback second. New optional fields with defaults automatically get this resilience for free. Unknown keys are stripped by Zod. Invalid values cause the entire review section to fall back to defaults with a warning -- existing behavior.

**Example:**
```typescript
// Adding new fields inside the existing reviewSchema
const reviewSchema = z.object({
  // ... existing fields
  enabled: z.boolean().default(true),
  autoApprove: z.boolean().default(true),
  // ... etc

  // NEW fields
  mode: z.enum(["standard", "enhanced"]).default("standard"),
  severity: z.object({
    minLevel: z.enum(["critical", "major", "medium", "minor"]).default("minor"),
  }).default({ minLevel: "minor" }),
  focusAreas: z.array(z.enum(["security", "correctness", "performance", "style", "documentation"])).default([]),
  ignoredAreas: z.array(z.enum(["security", "correctness", "performance", "style", "documentation"])).default([]),
  maxComments: z.number().min(1).max(25).default(7),
}).default({ /* all defaults */ });
```

### Pattern 3: Prompt-Level Output Format Enforcement

**What:** The review prompt tells Claude the exact output format for each comment (standard vs enhanced). The comment server validates the format as a guardrail, rejecting malformed output.

**When to use:** Enforcing structured output from Claude.

**Why:** This is already how the codebase works. `buildReviewPrompt()` defines the expected format in the "How to report issues" section. `sanitizeKodiaiReviewSummary()` in `comment-server.ts` validates the summary comment format. The same pattern extends to inline comment format validation.

### Anti-Patterns to Avoid

- **Post-processing severity filter:** Do not let Claude generate all findings then filter by severity. Claude should never generate below-minLevel findings. Set the threshold in the prompt.
- **Separate counting MCP tool:** Do not build an MCP tool that counts comments and rejects after limit. Tell Claude the limit in the prompt and trust it to self-limit. The prompt already says "ONLY report actionable issues" -- adding a count instruction is natural.
- **Mode-specific code paths in executor:** The executor stays unchanged. Mode differences are entirely prompt text differences.
- **Breaking standard mode backward compatibility:** Standard mode must produce output that looks like the current output (with the addition of severity prefix). Enhanced mode is opt-in.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML validation in comments | Custom YAML parser for comment body | Zod schema + prompt enforcement | Claude generates the YAML; the comment server validates format. Don't parse YAML output -- validate structure via string patterns. |
| Severity classification engine | Dedicated severity classification module | Prompt instructions with severity rules | The "hybrid model" is implemented entirely in prompt text: deterministic rules are bullet points in the prompt, LLM fallback is Claude's natural behavior for ambiguous cases. |
| Comment counting middleware | MCP request interceptor that counts calls | Prompt instruction: "Post at most N inline comments" | Claude reliably follows numeric limits when clearly stated. An MCP interceptor adds complexity and race conditions. |
| Config migration tool | Script to update old configs | Zod defaults + section-level fallback | New fields have defaults. Old configs without new fields parse identically to current behavior. Zero migration needed. |

**Key insight:** Phase 26 is almost entirely a prompt engineering exercise with config schema support. The "severity classification engine" and "comment limit enforcement" sound like they need code, but they are prompt instructions that Claude follows. The code changes are limited to config parsing, prompt text assembly, and output format validation.

## Common Pitfalls

### Pitfall 1: YAML Frontmatter Renders as Horizontal Rule

**What goes wrong:** Using raw `---` delimiters for YAML frontmatter in GitHub PR inline comments causes `---` to render as an `<hr>` horizontal rule, not as frontmatter delimiters. The structured metadata becomes garbled text with horizontal lines through it.

**Why it happens:** GitHub Flavored Markdown treats `---` at the start of a line as a thematic break (horizontal rule). YAML frontmatter is only recognized in the context of file rendering (e.g., .md files in repo view), not in comment bodies.

**How to avoid:** Use a fenced YAML code block for the metadata section in enhanced mode comments:

```
```yaml
severity: critical
category: security
suggested_action: fix_required
`` `

Finding details here...
```

This renders with YAML syntax highlighting and is parseable by splitting on the code fence markers.

**Warning signs:** If you see horizontal lines in review comments where metadata should be, the format is using raw `---` instead of code fences.

### Pitfall 2: Enhanced Mode Summary Comment Conflict

**What goes wrong:** The locked decision says "No top-level summary comment" in enhanced mode, but the existing `comment-server.ts` `sanitizeKodiaiReviewSummary()` validates and expects a summary comment. If the prompt tells Claude not to post a summary but the existing validation code still runs, no conflict occurs -- but if Claude accidentally posts a summary in enhanced mode, validation might pass when it should be blocked.

**Why it happens:** The current prompt explicitly instructs Claude to post a summary comment before inline comments when issues are found. Enhanced mode changes this behavior.

**How to avoid:** In enhanced mode, the prompt must explicitly instruct: "Do NOT post a summary comment. Post only inline comments. Each inline comment stands alone with its own severity/category metadata." The comment server does not need to block summaries -- if the prompt is clear, Claude will not generate one.

**Warning signs:** If enhanced mode reviews produce both a summary comment AND inline comments, the prompt instructions are not strong enough.

### Pitfall 3: Comment Cap Undermines Important Findings

**What goes wrong:** A hard cap of 7 comments might hide critical findings if the PR has more than 7 issues and the prioritization is wrong (e.g., showing 7 minor issues and hiding 1 critical one).

**Why it happens:** If the prompt says "at most 7 comments" without prioritization guidance, Claude might report issues in encounter order rather than severity order.

**How to avoid:** The prompt must say: "Post at most N inline comments, prioritized by severity (critical first, then major, medium, minor). If you found more issues than the limit allows, note the count of omitted findings in your final inline comment." This ensures critical issues always surface.

**Warning signs:** Review output shows minor issues while the diff clearly contains security vulnerabilities or critical bugs.

### Pitfall 4: Focus Areas Too Strict Hides Critical Issues

**What goes wrong:** User configures `focusAreas: [performance]` and a SQL injection vulnerability goes unreported because "security" is not in the focus list.

**Why it happens:** If focus area filtering is absolute (hard exclude), critical findings outside the focus scope get suppressed.

**How to avoid:** Critical-severity findings should always be reported regardless of focus area configuration. The prompt should say: "Focus your review on these categories: [X, Y]. For other categories, only report CRITICAL severity findings."

**Warning signs:** Security-sensitive changes in a PR with non-security focus areas configured, and no security findings reported.

### Pitfall 5: Standard Mode Severity Prefix Breaks Existing Summary Validation

**What goes wrong:** Adding `[MAJOR]` prefix to inline comments in standard mode changes the expected format of inline comment text. If the summary comment references inline comments by title, the format mismatch could break validation.

**Why it happens:** The existing `sanitizeKodiaiReviewSummary()` validates summary comment format against a specific regex pattern. If inline comment titles change format, and the summary references them, validation may fail.

**How to avoid:** Standard mode severity prefix is added to inline comments only, not to the summary comment format. The summary comment already uses severity headings ("Critical", "Major", "Medium", "Minor"). These are independent -- the inline comment prefix and the summary heading format do not need to match.

**Warning signs:** `sanitizeKodiaiReviewSummary()` throws errors on previously-valid summary formats after standard mode changes.

### Pitfall 6: Noise Suppression Contradicts Custom Instructions

**What goes wrong:** Noise suppression rules say "never flag style-only issues" but a user sets `review.prompt: "Please flag all style issues including import ordering"` via custom instructions. The noise suppression wins and overrides the user's explicit request.

**Why it happens:** Prompt precedence is unclear. The noise suppression section and custom instructions section both instruct Claude, and conflicting instructions produce unpredictable behavior.

**How to avoid:** Custom instructions should have higher precedence than default noise suppression. The prompt should order sections so custom instructions appear AFTER noise suppression rules, with an explicit note: "If custom instructions below conflict with the rules above, follow the custom instructions."

**Warning signs:** Users report that their custom `review.prompt` instructions are being ignored for certain issue types.

## Code Examples

Verified patterns from the existing codebase:

### Config Schema Extension Pattern
```typescript
// Source: src/execution/config.ts (existing pattern, lines 69-97)
// The existing reviewSchema shows how to add optional fields with defaults:
const reviewSchema = z
  .object({
    enabled: z.boolean().default(true),
    // ... existing fields

    // NEW: Review mode -- standard preserves current behavior, enhanced adds structured metadata
    mode: z.enum(["standard", "enhanced"]).default("standard"),

    // NEW: Severity filtering
    severity: z.object({
      minLevel: z.enum(["critical", "major", "medium", "minor"]).default("minor"),
    }).default({ minLevel: "minor" }),

    // NEW: Focus area targeting
    focusAreas: z.array(
      z.enum(["security", "correctness", "performance", "style", "documentation"])
    ).default([]),
    ignoredAreas: z.array(
      z.enum(["security", "correctness", "performance", "style", "documentation"])
    ).default([]),

    // NEW: Comment cap (configurable, default 7)
    maxComments: z.number().min(1).max(25).default(7),
  })
  .default({ /* all defaults -- zero-config works identically to current behavior */ });
```

### Prompt Section for Enhanced Mode
```typescript
// Example prompt section for enhanced mode inline comment format
const ENHANCED_MODE_INSTRUCTIONS = `
## Comment Format (Enhanced Mode)

Each inline comment MUST follow this exact structure:

\`\`\`yaml
severity: <critical|major|medium|minor>
category: <security|correctness|performance|style|documentation>
suggested_action: <fix_required|review_recommended|consider_refactor>
\`\`\`

<Finding title in bold>

<1-3 sentences explaining the issue, its impact, and why it matters.>

If you have a concrete fix, include a GitHub suggestion block after the explanation.

Do NOT post a top-level summary comment. Each inline comment stands alone.
`;
```

### Prompt Section for Standard Mode Severity Prefix
```typescript
// Example prompt section for standard mode severity prefix
const STANDARD_MODE_INSTRUCTIONS = `
## Comment Format (Standard Mode)

Each inline comment MUST begin with a severity prefix in square brackets:
[CRITICAL], [MAJOR], [MEDIUM], or [MINOR]

Example: "[MAJOR] Unhandled null dereference -- this will crash when user.profile is undefined."

After severity prefix, include the finding details and any suggestion blocks as normal.
`;
```

### Noise Suppression Prompt Section
```typescript
// Example noise suppression rules (always active, both modes)
const NOISE_SUPPRESSION_RULES = `
## Noise Suppression Rules

NEVER flag any of the following -- these are unconditionally suppressed:
- Style-only issues (formatting, whitespace, bracket placement)
- Trivial renamings (variable/function name preferences that don't affect correctness)
- Cosmetic preferences (import ordering, trailing commas, semicolons)
- "Consider using X instead of Y" when both are functionally equivalent
- Nitpicks about documentation wording or comment style
- Test file organization preferences

Focus exclusively on issues that affect: correctness, security, performance, error handling, resource management, and concurrency safety.
`;
```

### Comment Cap Prompt Section
```typescript
// Example comment cap instructions
function buildCommentCapInstructions(maxComments: number): string {
  return `
## Comment Limit

Post at most ${maxComments} inline comments for this PR review.

Prioritize by severity: CRITICAL findings first, then MAJOR, MEDIUM, MINOR.
If you found more issues than this limit allows, add a note at the end of your
final inline comment: "Note: N additional lower-severity issues were found but
omitted to keep the review focused."

Do NOT waste comment slots on low-severity findings when higher-severity issues exist.
`;
}
```

### Focus Area Prompt Section
```typescript
// Example focus area instructions
function buildFocusAreaInstructions(
  focusAreas: string[],
  ignoredAreas: string[],
): string {
  const lines: string[] = ["## Review Focus"];

  if (focusAreas.length > 0) {
    lines.push(
      "",
      `Concentrate your review on these categories: ${focusAreas.join(", ")}.`,
      "For categories NOT in this list, only report CRITICAL severity findings.",
    );
  }

  if (ignoredAreas.length > 0) {
    lines.push(
      "",
      `Explicitly SKIP these categories unless the finding is CRITICAL: ${ignoredAreas.join(", ")}.`,
    );
  }

  return lines.join("\n");
}
```

### Severity Guidelines Prompt Section
```typescript
// Example deterministic severity guidelines in the prompt
const SEVERITY_CLASSIFICATION_GUIDELINES = `
## Severity Classification

Use these rules to assign severity to each finding:

CRITICAL (must fix):
- SQL injection, XSS, command injection, path traversal
- Authentication bypass, authorization failures
- Secrets/credentials exposure in code
- Critical null pointer dereference in hot paths
- Infinite loops, deadlocks in production code
- Data corruption, data loss scenarios

MAJOR (should fix):
- Unhandled exceptions that crash the process
- Missing error handling on external calls (DB, API, file I/O)
- Race conditions under realistic concurrency
- Resource leaks (unclosed handles, connections, streams)
- Incorrect business logic that produces wrong results

MEDIUM (consider fixing):
- Edge case handling gaps
- Missing input validation (non-security context)
- Suboptimal error messages that hinder debugging
- Performance issues under moderate load

MINOR (nice-to-have):
- Unused variables or imports (production code only)
- Duplicate code that could be extracted
- Magic numbers without named constants
- Missing JSDoc on public APIs

PATH CONTEXT matters:
- Test files: downgrade severity by one level (e.g., MAJOR -> MEDIUM)
- Config files: only report CRITICAL issues (misconfigurations that break deployment)
- Documentation: only report factual errors (MEDIUM) or security-sensitive doc issues (CRITICAL)
`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat unstructured review comments | Severity-tagged structured comments with machine-parseable metadata | 2024-2025 (CodeRabbit, Copilot, Qodo) | Industry standard for AI code review tools; users expect severity tagging |
| Fixed review scope | Configurable focus areas and severity thresholds | 2025-2026 | Noise reduction is the #1 request for AI code review tools |
| Unlimited comment count | Hard cap on review comments (5-10 typical) | 2024-2025 | Reduces review fatigue; quality over quantity approach |
| Style + correctness mixed | Noise suppression (exclude style-only, cosmetic) | 2025-2026 | Most AI review tools now default to suppressing style nits |

**Industry patterns observed:**
- CodeRabbit uses review profiles (`chill` vs `assertive`) with configurable severity
- GitHub Copilot code review uses structured inline comments with categorized findings
- Qodo (formerly CodiumAI) uses adaptive severity calibration
- All major tools cap comment count and prioritize by severity

## Discretion Recommendations

These are recommendations for the areas marked as "Claude's Discretion" in CONTEXT.md.

### 1. YAML Frontmatter Rendering Format

**Recommendation: Use fenced ` ```yaml ` code block, not raw `---` delimiters.**

GitHub comments render `---` as horizontal rules (`<hr>` tags), making raw YAML frontmatter unusable. The fenced code block renders with YAML syntax highlighting, is visually distinct from the finding text, and is machine-parseable by splitting on the code fence markers.

Example of how it renders in GitHub:
```
```yaml
severity: critical
category: security
suggested_action: fix_required
`` `

**SQL injection vulnerability**

The user input is interpolated directly into the query string without parameterization...
```

### 2. Standard Mode Format

**Recommendation: Text prefix only, no YAML frontmatter.**

Standard mode should use `[SEVERITY]` prefix (e.g., `[MAJOR] Unhandled null dereference`). This is lightweight, visually scannable, backward-compatible with existing review output, and does not add visual noise. YAML frontmatter in standard mode would be confusing for users who chose standard specifically for simplicity.

### 3. `review.format: plain` Config Option

**Recommendation: Do NOT add this option in Phase 26.**

Standard mode already serves as the "plain" format (identical to current behavior plus severity prefix). Adding a third format option increases config complexity without clear value. If users want zero structure, they can omit mode configuration entirely and get standard behavior. Revisit if users request it after Phase 26 ships.

### 4. Comment Prioritization Strategy

**Recommendation: Severity-first with file-spread tiebreaker.**

When more than `maxComments` issues are found:
1. Sort by severity (CRITICAL > MAJOR > MEDIUM > MINOR)
2. Within the same severity level, spread across different files rather than clustering multiple findings on the same file
3. This ensures critical issues always surface and the review covers breadth over depth

Instruct this in the prompt, not in code. Claude handles prioritization well when given clear rules.

### 5. Communicating Omitted Issues

**Recommendation: Add a count note on the final inline comment.**

When findings exceed the comment limit, the last inline comment should end with:
> _Note: 3 additional medium/minor issues were found but omitted to keep the review focused. Increase `review.maxComments` in `.kodiai.yml` to see more._

This communicates that findings were omitted, tells the user how many, and provides actionable guidance to increase the limit. This is implemented as a prompt instruction, not code.

### 6. Configurable Comment Limit

**Recommendation: Make it configurable via `review.maxComments` with default 7.**

The user questioned the fixed 7-comment cap. Making it configurable respects user preferences while keeping a sensible default. Range: 1-25 (min 1 because 0 would disable review output; max 25 to prevent comment spam). Field: `review.maxComments: 7` in `.kodiai.yml`.

### 7. minLevel Filtering vs Comment Limit Ordering

**Recommendation: Apply minLevel filtering BEFORE comment limit.**

Sequence:
1. Claude evaluates findings per the prompt (already filtered by minLevel in the prompt)
2. Claude prioritizes by severity
3. Claude applies the comment limit

Since minLevel is a prompt-level instruction ("do NOT report findings below major"), Claude never generates sub-threshold findings. The comment limit then applies to the already-filtered set. This is the natural order and requires no special handling.

### 8. Non-Focus Category Suppression Strictness

**Recommendation: Soft suppression with critical exception.**

When `focusAreas` is configured:
- Focus categories: report all findings at or above minLevel
- Non-focus categories: only report CRITICAL findings
- This prevents hiding SQL injection because the user configured `focusAreas: [performance]`

This is safer than hard suppression (which could hide security vulnerabilities) and simpler than soft de-prioritization (which requires nuanced weighting in the prompt).

## Open Questions

1. **Enhanced mode `related_docs_url` field**
   - What we know: The locked decision includes `related_docs_url` as an optional field in the YAML frontmatter
   - What's unclear: Claude's reliability at generating accurate documentation URLs for arbitrary codebases and languages (e.g., linking to the correct MDN page for a JavaScript API)
   - Recommendation: Include the field in the schema and prompt, mark it as optional, and accept that Claude may omit it for many findings. Do not validate URL correctness -- trust Claude's judgment. If the URL is wrong, it is a minor quality issue, not a correctness issue.

2. **Existing summary comment format interaction**
   - What we know: Enhanced mode says "no summary comment." Standard mode preserves current behavior (which includes a summary).
   - What's unclear: Whether the comment server `sanitizeKodiaiReviewSummary()` needs to be mode-aware or if the prompt alone prevents summary generation in enhanced mode.
   - Recommendation: Start with prompt-only enforcement. If Claude occasionally generates a summary in enhanced mode despite instructions, add a mode check to the comment server that logs a warning but does not block (to avoid breaking the review).

3. **Auto-approval interaction with enhanced mode**
   - What we know: Auto-approval fires when `result.published === false` (no GitHub output). Enhanced mode eliminates the summary comment but keeps inline comments.
   - What's unclear: Whether the absence of a summary comment could confuse the auto-approval logic.
   - Recommendation: No change needed. Auto-approval checks `published` flag, which is set by `onPublish()` callback in MCP servers. If inline comments are posted, `published = true`, and auto-approval is skipped. If no issues found, no comments posted, `published = false`, and auto-approval proceeds. This works identically regardless of mode.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/execution/config.ts` (config schema pattern, section-level fallback, Zod validation)
- Codebase analysis: `src/execution/review-prompt.ts` (prompt construction, existing format instructions, noise rules)
- Codebase analysis: `src/execution/mcp/comment-server.ts` (summary format validation, severity headings)
- Codebase analysis: `src/execution/mcp/inline-review-server.ts` (inline comment creation, idempotency)
- Codebase analysis: `src/handlers/review.ts` (review handler pipeline, config loading, prompt building call site)
- Codebase analysis: `src/execution/executor.ts` (executor is thin wrapper, prompt-driven behavior confirmed)
- Architecture research: `.planning/research/ARCHITECTURE.md` (integration architecture, prompt enrichment pattern)
- GitHub Docs: fenced code blocks with language identifiers render with syntax highlighting in comments
- GitHub Markdown behavior: `---` in comment bodies renders as horizontal rule, not frontmatter delimiter

### Secondary (MEDIUM confidence)
- CodeRabbit configuration reference -- review profiles, severity configuration patterns
- Industry survey of AI code review tools (CodeRabbit, Copilot, Qodo) -- severity tagging and comment caps are standard
- GitHub GFM spec -- thematic break (`---`) rendering rules

### Tertiary (LOW confidence)
- Claude's reliability at self-limiting comment count to exactly N -- tested informally via prompting, but not formally validated in production at scale. Mitigation: the prompt-based approach is the standard pattern in this codebase and has worked reliably for existing format constraints.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns verified in codebase
- Architecture: HIGH -- extends existing config/prompt/validation pattern with no structural changes
- Pitfalls: HIGH -- YAML rendering issue verified via GitHub documentation; comment cap and focus area pitfalls derived from industry patterns
- Discretion recommendations: MEDIUM -- based on codebase analysis and industry patterns, but some (e.g., Claude's reliability at comment self-limiting) need production validation

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable domain -- config schema and prompt patterns do not change rapidly)
