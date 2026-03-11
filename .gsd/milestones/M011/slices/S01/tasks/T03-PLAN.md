# T03: 60-issue-q-a 03

**Slice:** S01 — **Milestone:** M011

## Description

Wire issue Q&A behavior end-to-end in the mention handler so issue mentions reliably produce actionable answers with path pointers or focused clarification.

Purpose: This integration step satisfies ISSUE-01 at runtime by combining prompt contract + code-pointer enrichment + deterministic fallback on silent/non-published runs.
Output: Mention handler updates for issue comments plus regression tests proving direct answer path and underspecified fallback path.

## Must-Haves

- [ ] "@kodiai mentions in issue comments produce a direct in-thread answer"
- [ ] "Issue answers include concrete file-path pointers when code context matters"
- [ ] "Underspecified issue asks get targeted clarifying questions instead of guesses"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
