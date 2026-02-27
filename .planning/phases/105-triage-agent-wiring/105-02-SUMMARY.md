---
phase: 105-triage-agent-wiring
plan: 02
status: complete
---

# Plan 105-02 Summary: Triage Validation Agent (TDD)

## What was built
- `validateIssue()` reads templates from workspace, matches best-fit, diffs against issue body
- `generateGuidanceComment()` produces friendly bulleted missing-section guidance
- `generateLabelRecommendation()` returns convention-based `needs-info:{slug}` labels with allowlist gating
- `generateGenericNudge()` returns template-suggestion message for unmatched issues

## Key files
- `src/triage/triage-agent.ts` — validateIssue, generateGuidanceComment, generateLabelRecommendation, generateGenericNudge
- `src/triage/triage-agent.test.ts` — 20 tests, all passing

## Test results
- 20/20 tests pass
- Covers: valid issues, missing sections, empty sections, no template match, null body, best-fit selection, guidance comments, label recommendations, generic nudge

## Decisions
- Used real filesystem (mkdtemp) for tests instead of mocking fs modules -- more reliable
- Best-fit template matching counts heading matches, requires at least 1
- Label allowlist supports both exact match and prefix match patterns
