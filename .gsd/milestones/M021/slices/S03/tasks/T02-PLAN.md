# T02: 105-triage-agent-wiring 02

**Slice:** S03 — **Milestone:** M021

## Description

Implement the triage validation agent using TDD.

Purpose: Validate an issue body against repo templates, generate structured guidance comments and label recommendations.
Output: `triage-agent.ts` and `triage-agent.test.ts` in `src/triage/`

## Must-Haves

- [ ] "validateIssue() fetches templates from workspace .github/ISSUE_TEMPLATE/ directory"
- [ ] "validateIssue() matches issue body against the best-fit template"
- [ ] "generateGuidanceComment() produces a friendly bulleted list of missing sections with hints"
- [ ] "generateLabelRecommendation() returns needs-info:{template_slug} convention-based label"
- [ ] "No label recommended when issue passes validation"
- [ ] "Generic nudge returned when no template matches the issue"
- [ ] "Comment only shows what is missing, not a full pass/fail breakdown"

## Files

- `src/triage/triage-agent.ts`
- `src/triage/triage-agent.test.ts`
