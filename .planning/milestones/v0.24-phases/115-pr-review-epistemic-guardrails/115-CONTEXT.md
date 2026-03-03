# Phase 115: PR Review Epistemic Guardrails - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Add epistemic boundary rules to the PR review prompt so the LLM distinguishes diff-visible facts from external knowledge claims. Prevent hallucinated assertions about version numbers, API release dates, or library behavior. This phase is prompt-only — no post-LLM classification, severity demotion, or output filtering (those are phases 117-119). Also cleans up conventional commit guidance to be diff-grounded.

</domain>

<decisions>
## Implementation Decisions

### Epistemic Boundary Rules
- Use both allowlist AND denylist approach (belt and suspenders) — explicitly list what CAN be asserted as fact, AND list common hallucination patterns to avoid
- Categories: diff-visible (code changes, file paths, variable names, version strings in lockfiles), system-provided enrichment (security advisories, changelog data from APIs, prior PR comments), and external knowledge (library behavior, API changes between versions, release dates, CVE details not in diff)
- Diff-visible and system-provided enrichment are grounded — the LLM can state these as fact
- External knowledge claims that cannot be verified via web search or system enrichment must be silently omitted — do not mention, do not hedge, do not acknowledge the limitation, just leave them out
- General programming knowledge (null deref = crash, SQL injection risk, etc.) is allowed — the boundary targets specific external claims about libraries, versions, APIs, and dates

### Universal Citation Rules
- Everything asserted must be cited — this is a universal principle, not per-section
- Diff-visible findings cite file:line (existing behavior)
- System-provided enrichment must cite source URL using footnote format: `per changelog data[1]` with `[1]` being a linked URL at the end of the review
- If no URL is available for a source, the claim cannot be cited and therefore cannot be asserted
- Footnote citation format defined once in the epistemic section as a universal rule for the entire review
- System enrichment data must include URLs — security advisories, changelog APIs, prior PR comments all provide linkable sources

### Hedging Scope Change
- Rewrite the entire hedging/tone section from scratch — do not just scope existing examples
- Replace "Do NOT use hedged or vague language" DO/DON'T pairs with an epistemic principle: assert what you can verify from the diff, omit what you can't
- Update the stabilizing language section ("preserves existing behavior", "backward compatible", "minimal impact") as well — Claude's discretion on the exact rewrite direction (grounding in diff evidence vs removal)
- Keep the "Prefix Preference findings with Optional:" instruction — that's about severity labeling, not epistemic boundaries
- Epistemic rules apply with same strictness to all severity levels including Preference/Optional findings

### Dep-bump Behavior
- Rewrite BOTH major-bump AND minor/patch-bump focus instruction lists to be diff-grounded
- For major bumps: keep "MAJOR version bump" as a factual label (semver is diff-visible), cite specific changes only from system-provided enrichment with footnote URLs, do not speculate about what the dependency changed
- For minor/patch bumps: focus on lockfile consistency, dependency tree changes, import changes — all diff-visible
- Security advisory data from APIs is grounded — cite with footnote URL
- For unenriched dep-bumps (no advisories, no changelog): explicitly note that enrichment was unavailable ("No changelog or advisory data available for this update. Review based on diff contents only.") then focus purely on lockfile + code changes
- Add extra epistemic reinforcement in buildDepBumpSection: "Do not assert what this version update contains, fixes, or changes. Only describe what you observe in the diff and cite system-provided data."
- Footnote citation style applies to all dep-bump enrichment sections (security, changelog) — consistent with the universal rule

### Conventional Commit Guidance Cleanup
- Clean up conventional commit type guidance to be diff-grounded (done in this phase, not deferred)
- Current claims like "pay extra attention to: breaking changes in public APIs" encourage external knowledge assertions — rewrite to reference only what's visible in the diff
- The epistemic section governs all downstream sections including conventional commit

### Prompt Placement
- New dedicated `buildEpistemicBoundarySection()` helper function — follows existing pattern (buildToneGuidelinesSection, buildAuthorExperienceSection, etc.), independently testable
- Place epistemic section BEFORE conventional commit context section — epistemic rules govern all downstream sections
- Single core block in buildEpistemicBoundarySection() + targeted reinforcements in buildDepBumpSection and conventional commit guidance (belt and suspenders)
- Ordering: ... → PR intent scoping → Focus hints → **Epistemic Boundaries** → Conventional Commit Context → Tone Guidelines → Author Experience → Dep-bump context → ...

### Claude's Discretion
- Exact wording of epistemic boundary categories, allowlist items, and denylist items
- How to restructure the hedging/stabilizing language section
- Precise wording of diff-grounded conventional commit guidance
- How to update buildSecuritySection and buildChangelogSection to output footnote citations
- Test structure and test case selection

</decisions>

<specifics>
## Specific Ideas

- The epistemic rules should follow the same DO/DON'T pattern the prompt already uses for language guidelines — consistent style
- For dep-bump PRs: "This PR updates X from version A to B" (diff-visible) is fine, "X version B introduced feature Y" (external) must be omitted
- The goal is that reviewing a dependency bump PR produces findings about code/lockfile changes only, not assertions about what changed in the dependency itself
- Citation example: `This update addresses a known vulnerability per security advisory[1]` with `[1]: https://github.com/advisories/GHSA-xxxx`
- The "no URL = no assertion" rule means system enrichment pipelines need to propagate URLs — if a changelog API returns text without a link, that text can't be cited in the review

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildToneGuidelinesSection()` (line 238): Will be rewritten — currently contains blanket "Do NOT use hedged language" rule
- `buildDepBumpSection()` (line 1336): Contains external-knowledge-triggering focus lists (lines 1385-1401) that need rewriting + epistemic reinforcement
- `buildSecuritySection()` and `buildChangelogSection()`: Enrichment sections that need footnote citation format
- `review-prompt.test.ts`: Extensive test file for prompt construction — ~1500 lines of tests

### Established Patterns
- Helper functions per concern: each returns a string block, called from buildReviewPrompt()
- Rules use markdown heading + bullet point format
- DO/DON'T example pairs for language guidance
- Conventional commit type guidance uses Record<string, string> map (line 1797)

### Integration Points
- `buildReviewPrompt()` (line 1476): Main assembly function — new epistemic section inserted before conventional commit context (before line 1796)
- `buildDepBumpSection()` (line 1336): Rewrite focus lists + add epistemic reinforcement
- `buildToneGuidelinesSection()` (line 238): Full rewrite of hedging and stabilizing language
- Conventional commit `typeGuidance` Record (line 1797): Rewrite guidance strings to be diff-grounded
- `buildSecuritySection()` / `buildChangelogSection()`: Add footnote citation format

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 115-pr-review-epistemic-guardrails*
*Context gathered: 2026-03-02*
