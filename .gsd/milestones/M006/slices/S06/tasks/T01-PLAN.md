# T01: 35-findings-organization-and-tone 01

**Slice:** S06 — **Milestone:** M006

## Description

Rewrite the standard-mode Observations section prompt from severity-only grouping to Impact/Preference subsections with inline severity tags. Add PR intent scoping instructions, tone/language guidelines, and stabilizing language rules. Thread PR labels from the handler to the prompt builder.

Purpose: Findings are categorized by real impact vs preference, scoped to PR intent, and expressed with specific low-drama language (FORMAT-06, FORMAT-07, FORMAT-08, FORMAT-17, FORMAT-18).
Output: Updated prompt template, handler threading, and comprehensive tests.

## Must-Haves

- [ ] "Observations section template instructs Claude to split findings into ### Impact and ### Preference subsections"
- [ ] "Each finding in the template uses inline severity tags: [CRITICAL], [MAJOR], [MEDIUM], [MINOR]"
- [ ] "PR intent scoping instructions tell Claude to scope findings to the PR's stated intent from title, description, labels, and branch"
- [ ] "Tone guidelines instruct Claude to use concrete language (causes X when Y) and avoid hedged possibilities"
- [ ] "Stabilizing language guidelines instruct Claude to call out low-risk changes with preserves existing behavior, backward compatible, minimal impact"
- [ ] "PR labels are threaded from the handler through to the prompt builder when available"

## Files

- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/handlers/review.ts`
