# M061/S03 — Research

**Date:** 2026-04-23

## Summary

S03 is not starting from a missing-instrumentation problem. After S01, the review path already persists text-free prompt-section telemetry through `prompt_section_events`, and the review handler already records prompt sections when it dispatches `taskType="review.full"`. The main issue is that `src/execution/review-prompt.ts` currently collapses the entire rendered review prompt into a single section named `review-user-prompt`, which means the operator report can only tell us total prompt size, not which review sections are consuming that budget.

The review prompt is also already partly compacted in one important place: the handler prefers unified retrieval (`unifiedResults` + `contextWindow`) over the older three-way retrieval/precedent/wiki path. That means the roadmap’s “packed unified knowledge-context representation” is not speculative; the code is already wired for it. The remaining S03 work is to turn that partial compaction into an enforceable contract by budgeting the expensive sections independently, proving those budgets in prompt telemetry, and keeping the review path truthful when a section must be trimmed or omitted.

The right unit of change is the review prompt builder seam, not the telemetry store and not the final executor. `buildReviewPromptDetails()` is where large prompt sections are assembled in a fixed order: PR description, changed files, diff analysis, large-PR triage, incremental context, graph/structural impact, unified or legacy knowledge context, linked issues, language guidance, rules/instructions, contributor experience, boundedness, and summary-format instructions. S03 should make those sections first-class budgeted blocks instead of one giant text blob. Then the existing telemetry/reporting path can prove which sections got smaller and whether truncation happened.

## Recommendation

Implement per-section budgeting inside `src/execution/review-prompt.ts` and return true section-level metrics from `buildReviewPromptDetails()` rather than a single `review-user-prompt` block. Keep the current prompt content contract intact at first, but split the builder into explicit sections with budgets and truncation markers for the high-cost areas:

1. **Changed-files / diff-shape context**
2. **Large-PR / incremental / boundedness context**
3. **Unified knowledge context** (or legacy retrieval/precedent/wiki when unified results are absent)
4. **Graph / structural impact evidence**
5. **Instruction-heavy tail** (rules, severity, mode, tone, contributor guidance, verdict template)

The goal is not to make every section tiny. The goal is to make prompt cost attributable and enforceable. For example, the instruction-heavy tail is mostly static and likely large, but because it is one stable block it can be budgeted once and then monitored. The volatile expensive sections are the ones driven by PR size and retrieval volume: changed files, structural context, and knowledge context. Those need their own caps and omission behavior.

Preserve the existing unified-retrieval-first topology rather than reintroducing separate retrieval/precedent/wiki blocks as the default. The code already does the right thing here:
- `src/handlers/review.ts` threads `unifiedResults` and `contextWindow` into the prompt context.
- `src/execution/review-prompt.ts` prefers a single unified section when `unifiedResults` are present.

So S03 should harden that path, not redesign it. The likely implementation shape is:
- convert the builder from `const lines: string[]` plus one final `buildPromptBuildResult([{ sectionName: ..., text }])`
- to a `PromptSectionInput[]` assembly where each named section is appended only after local truncation/budget enforcement
- and then let `buildPromptBuildResult()` produce the final text plus real section metrics.

## Implementation Landscape

### Existing seams that already support S03

- `src/execution/review-prompt.ts`
  - `buildReviewPromptDetails()` already has clear conceptual section boundaries in code order.
  - It already supports a compact unified retrieval path via `formatUnifiedContext({ unifiedResults, contextWindow })`.
  - It already has bounded sub-builders in some places, but those bounds are local and invisible to prompt telemetry because the final result is emitted as one section.

- `src/handlers/review.ts`
  - Already assembles the review prompt from a rich context object and records prompt sections through `buildPromptSectionRecord(... promptKind: "review.user-prompt" ...)`.
  - Already distinguishes retrieval/context assembly timing as its own phase, which gives S03 a natural proof seam for “prompt got smaller without moving work elsewhere.”
  - Already prefers unified retrieval results for prompt context and keeps the older retrieval/precedent/wiki fields as fallback.

- `src/execution/prompt-section-metrics.ts`
  - Already supports multiple sections with names, positions, char counts, estimated tokens, and truncation flags.
  - No telemetry schema work is needed to expose finer review prompt sections; S03 mainly needs to emit them.

- `src/telemetry/store.ts` and `scripts/usage-report.ts`
  - Already persist and report section-level prompt metrics from `prompt_section_events`.
  - Once S03 emits multiple review sections, the canonical operator report will immediately surface them without a new reporting path.

### Real gaps S03 must close

1. **Review prompt telemetry is currently too coarse to prove section budgets.**
   `buildReviewPromptDetails()` returns only:
   - `sectionName: "review-user-prompt"`
   - `charCount: full prompt length`

   That is enough for S01 baseline visibility but not enough for S03’s “budget enforcement” acceptance language.

2. **Budget enforcement is mostly implicit today.**
   Some subsections already cap or sanitize inputs, but there is no explicit contract that says:
   - this section may consume at most N chars/tokens,
   - this section may truncate with a scale note,
   - this section is dropped entirely when empty or over budget.

3. **The operator proof cannot yet answer “what got smaller?”**
   `scripts/usage-report.ts` groups by `task_type / prompt_kind / section_name`. Until review prompt sections are emitted separately, the report will continue to show one large review block and hide the real compaction story.

### Likely files affected by S03

- `src/execution/review-prompt.ts` — primary implementation seam
- `src/execution/review-prompt.test.ts` — section accounting, truncation, and omission tests
- `src/handlers/review.ts` — should remain mostly wiring-only, but may need assertions or minor plumbing if section names/promptKind behavior changes
- `scripts/usage-report.test.ts` — if any report assumptions currently expect review to be a single section
- `scripts/verify-m061-s01.ts` or a new `verify-m061-s03.ts` — to prove that review prompt sections are now named and budget-attributed

## Proposed Build Order

1. **Refactor `buildReviewPromptDetails()` into explicit section builders**
   Preserve the rendered prompt contract as much as possible, but stop building one monolithic `lines` array with one final metric block.

2. **Add local budgeting/truncation to the high-cost review sections**
   Start with the sections most likely to vary by PR size or retrieval volume:
   - changed files / scale notes
   - unified knowledge context
   - graph / structural impact
   - incremental or large-PR context

3. **Emit real section metrics through `buildPromptBuildResult()`**
   Keep `promptKind: "review.user-prompt"`, but provide multiple named sections beneath it.

4. **Lock the contract with prompt tests before changing verification/reporting**
   The prompt builder is the truth surface. Once its section names and truncation semantics are stable, the report/verifier updates become mechanical.

5. **Add slice-level verification that reads the canonical telemetry/report seam**
   Do not build a one-off snapshot comparer. Use `prompt_section_events` through the existing report flow.

## Verification Approach

### Unit / contract tests

Run and extend:
- `bun test ./src/execution/review-prompt.test.ts`
- `bun test ./src/handlers/review.test.ts`
- `bun test ./scripts/usage-report.test.ts ./scripts/verify-m061-s01.test.ts`

### New assertions S03 should add

- `buildReviewPromptDetails()` returns **multiple named sections** for review prompts, not just `review-user-prompt`.
- High-cost sections report `truncated: true` when their local budget trims them.
- Unified retrieval remains the preferred knowledge-context path when `unifiedResults` are present.
- Legacy retrieval/precedent/wiki sections remain omitted when unified retrieval is active.
- The final rendered prompt still contains the required safety/truthfulness/review-format guidance even after section budgeting.
- Review execution still records `promptKind: "review.user-prompt"` with multiple section rows in `prompt_section_events`.

### Operator proof

Use the canonical telemetry/report flow after implementation to show:
- `review.full / review.user-prompt / <section-name>` rows now exist in `prompt_section_events`
- the expensive review sections have bounded estimated token totals
- truncation is visible by section when it occurs
- mention/review reporting still comes from Postgres-backed canonical telemetry, not a sidecar script

## Constraints

- The review prompt carries a lot of policy/instruction text by design. S03 should not fake “compaction” by deleting truthfulness or security constraints that exist to keep behavior correct.
- `src/handlers/review.ts` already distinguishes retrieval/context assembly timing; S03 should avoid merely shifting cost from prompt text into larger pre-prompt computation without making that trade visible.
- The prompt builder has accumulated many feature-specific sections over time. A section-budget refactor should preserve local helper boundaries instead of creating one new monolith around them.
- Backward compatibility matters for prompt semantics even if exact text changes. The safest path is structural refactor + bounded sections, not a full prompt rewrite.

## Common Pitfalls

- **Calling it “budget enforcement” while still emitting one monolithic review section.** That would leave the operator surface unable to prove anything section-specific.
- **Re-expanding the legacy retrieval path.** The unified context path is already the compact shape; S03 should strengthen it, not regress to three parallel knowledge sections.
- **Cutting guidance instead of variable context.** The instruction tail is large but mostly fixed; the more important budget wins are in volatile contextual sections that scale with PR size.
- **Moving costs out of prompt text without preserving truthful observability.** If the prompt shrinks only because more state is precomputed elsewhere and hidden from telemetry, the slice has not actually improved operator truth.

## Open Risks

- Some instruction-heavy sections may still dominate total prompt size even after volatile context is compacted. If that happens, S03 may need a second pass on static instruction deduplication, but it should only happen after section-level attribution proves where the real mass is.
- Structural impact, graph context, and unified retrieval are all independently useful, but together they may duplicate adjacent evidence on some PRs. S03 may uncover the need for a precedence rule between those sections, not just separate budgets.
- The review prompt test suite is already large. A blunt rewrite will create expensive churn. The lowest-risk path is to preserve existing helper outputs and add section wrappers/bounds around them.
