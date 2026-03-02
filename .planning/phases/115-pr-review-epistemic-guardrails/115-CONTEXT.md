# Phase 115: PR Review Epistemic Guardrails - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Add epistemic boundary rules to the PR review prompt so the LLM distinguishes diff-visible facts from external knowledge claims. Prevent hallucinated assertions about version numbers, API release dates, or library behavior. This phase is prompt-only — no post-LLM classification, severity demotion, or output filtering (those are phases 117-119).

</domain>

<decisions>
## Implementation Decisions

### Epistemic Boundary Rules
- Use both explicit categories AND example pairs (matches existing prompt style)
- Categories: diff-visible (code changes, file paths, variable names, version strings in lockfiles), system-provided enrichment (security advisories, changelog data from APIs), and external knowledge (library behavior, API changes between versions, release dates, CVE details not in diff)
- Diff-visible and system-provided enrichment are grounded — the LLM can state these as fact
- External knowledge claims must be omitted entirely — do not mention, do not hedge, just leave them out
- General programming knowledge (null deref = crash, SQL injection risk, etc.) is allowed — the boundary targets specific external claims about libraries, versions, APIs, and dates

### Hedging Scope Change
- Scope the existing "Do NOT use hedged or vague language" rule to diff-visible facts only
- Rewrite as an epistemic principle rather than example pairs: "State facts you can verify from the diff with certainty. Never speculate about behavior, versions, or changes outside the diff."
- Keep the stabilizing language section ("preserves existing behavior", "backward compatible", "minimal impact") as a separate concern — it's about tone for low-risk changes, not epistemic boundaries
- Epistemic rules apply with same strictness to all severity levels including Preference/Optional findings

### Dep-bump Behavior
- Rewrite dep-bump focus instructions to be diff-grounded: focus on what the PR code does (lockfile consistency, import changes, config changes, test changes) rather than what the dependency changed
- Security advisory data from APIs is grounded — cite as system-provided fact
- For unenriched dep-bumps (no advisories, no changelog), focus purely on lockfile + code changes, don't speculate about dependency contents
- Add extra epistemic reinforcement in buildDepBumpSection specifically: "Do not assert what this version update contains, fixes, or changes. Only describe what you observe in the diff." — dep-bumps are where hallucinations are worst

### Prompt Placement
- New dedicated `buildEpistemicBoundarySection()` helper function — follows existing pattern (buildFindingLanguageSection, buildAuthorExperienceSection, etc.), independently testable
- Place epistemic section BEFORE Finding Language Guidelines — boundaries define WHAT you can say, then language guidelines define HOW to say it
- Additional dep-bump-specific reinforcement in buildDepBumpSection (belt and suspenders — core rules always present, extra reminder in dep-bump context)

### Claude's Discretion
- Exact wording of epistemic boundary categories and examples
- How to restructure the hedging section's existing examples
- Precise wording of dep-bump focus instruction rewrites
- Test structure and test case selection

</decisions>

<specifics>
## Specific Ideas

- The epistemic rules should follow the same DO/DON'T pattern the prompt already uses for hedging and language guidelines — consistent style
- For dep-bump PRs: "This PR updates X from version A to B" (diff-visible) is fine, "X version B introduced feature Y" (external) must be omitted
- The goal is that reviewing a dependency bump PR produces findings about code/lockfile changes only, not assertions about what changed in the dependency itself

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildFindingLanguageSection()` (line ~237): Pattern for the new epistemic section — returns a string block with rules + examples
- `buildDepBumpSection()` (line ~1336): Where dep-bump-specific epistemic reinforcement goes
- `buildBaseReviewRules()`: Where the new section gets called from, alongside other base rules
- `review-prompt.test.ts`: Existing test file for prompt construction

### Established Patterns
- Helper functions per concern: each returns a string block, called conditionally from buildReviewPrompt()
- Rules use markdown heading + bullet point format
- DO/DON'T example pairs for language guidance

### Integration Points
- `buildReviewPrompt()` (line 1476): Main assembly function — new section inserted before Finding Language Guidelines
- `buildDepBumpSection()` (line 1336): Add epistemic reinforcement to dep-bump focus instructions
- `buildFindingLanguageSection()` (line ~237): Scope the existing hedging rule to diff-visible facts

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 115-pr-review-epistemic-guardrails*
*Context gathered: 2026-03-02*
