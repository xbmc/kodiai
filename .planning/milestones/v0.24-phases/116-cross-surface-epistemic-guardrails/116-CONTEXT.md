# Phase 116: Cross-Surface Epistemic Guardrails - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Propagate epistemic guardrails to all bot response surfaces (mention responses and Slack assistant) so they match the PR review surface. All surfaces should refuse to assert external facts without grounding, using a single shared source of truth for epistemic rules.

</domain>

<decisions>
## Implementation Decisions

### Guardrail consistency
- Single shared function for epistemic rules across all surfaces — one source of truth
- Rewrite `buildEpistemicBoundarySection()` to use generic, surface-neutral language (e.g., "every assertion in your response" not "every assertion in this review")
- Verification-first rule: attempt verification (WebSearch/WebFetch/enrichment data) first, assert with citation if verified, silently omit if unverifiable
- This verification-first rule applies to all three surfaces equally — surfaces without WebSearch tools naturally fall through to the "omit if unverifiable" path

### Surface-specific adaptation
- Mention prompt: conditional logic based on `mention.surface` — PR mentions get full diff-grounding rules, issue mentions get issue-body + thread context as their "context-visible" tier
- Slack prompt: can be rewritten as necessary to integrate epistemic guardrails — not limited to inserting a section; resolve conflicts between existing "never hedge" rule and epistemic boundaries
- Citation format and diff-visible tier adaptation per surface: Claude's discretion
- Slack hedge vs. omit tension resolution: Claude's discretion

### Mention prompt rewrite scope
- Replace or merge the existing "Factual Accuracy — CRITICAL" section with the shared epistemic section: Claude's discretion on what to keep vs. replace
- Issue mentions: "context-visible" tier maps to issue body, comment thread, linked code snippets — assert what you can see, cite accordingly
- PR mentions: full epistemic section with diff-grounding rules
- Test each surface individually — add tests for PR mention, issue mention, and Slack that verify epistemic guardrails appear in each prompt

### Claude's Discretion
- How to adapt citation format per surface (footnotes vs. inline links vs. parenthetical sources)
- How to generalize "diff-visible" tier when no diff exists (likely "context-visible" approach)
- Whether to keep any part of the existing mention "Factual Accuracy" section or fully replace it
- How to resolve Slack "never hedge" rule vs. epistemic "silently omit" rule

</decisions>

<specifics>
## Specific Ideas

- User wants verification-first behavior: "I want to verify all external claims and if you can't verify them, omit them"
- Slack prompt rewrite is unconstrained: "you can rewrite as necessary, doesn't have to be light"

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildEpistemicBoundarySection()` in `src/execution/review-prompt.ts:238` — already exported, full 3-tier epistemic system. Needs generalization from review-specific to surface-neutral language
- `buildToneGuidelinesSection()` in `src/execution/review-prompt.ts:289` — has epistemic principle line that may also need surface-neutral update
- `formatUnifiedContext()` in `src/execution/review-prompt.ts` — used by mention prompt for knowledge base context

### Established Patterns
- PR review prompt assembles sections via helper functions (`buildEpistemicBoundarySection`, `buildToneGuidelinesSection`) — same pattern should extend to other surfaces
- Mention prompt builds prompt as string array with `lines.push()` pattern
- Slack prompt uses `buildSlackAssistantPrompt()` in `src/slack/assistant-handler.ts:90` — inline string array, not modular helpers

### Integration Points
- `src/execution/mention-prompt.ts` — `buildMentionPrompt()` needs epistemic section insertion (conditional on surface type) and existing "Factual Accuracy" section rework
- `src/slack/assistant-handler.ts` — `buildSlackAssistantPrompt()` needs epistemic section insertion and potential restructure
- `src/execution/review-prompt.ts` — `buildEpistemicBoundarySection()` needs generalization to surface-neutral language
- Test files: `src/execution/mention-prompt.test.ts`, `src/slack/assistant-handler.test.ts`, `src/execution/review-prompt.test.ts`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 116-cross-surface-epistemic-guardrails*
*Context gathered: 2026-03-02*
