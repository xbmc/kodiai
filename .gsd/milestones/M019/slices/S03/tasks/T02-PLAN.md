# T02: 95-ci-failure-recognition 02

**Slice:** S03 — **Milestone:** M019

## Description

Build the check_suite.completed webhook handler, CI section formatter, and wire everything into the application. The handler fetches check runs for the PR head SHA and base-branch commits, classifies failures using the classifier from Plan 01, formats a markdown section, and posts/updates a CI annotation comment on the PR.

Purpose: Completes the CI failure recognition feature end-to-end — from webhook event to visible PR annotation.
Output: ci-failure-formatter.ts, ci-failure.ts handler, updated index.ts

## Must-Haves

- [ ] "When check_suite.completed fires for a PR with failures, Kodiai posts/updates a CI analysis section as a comment on the PR"
- [ ] "The CI section shows a summary line ('N of M failures appear unrelated') with expandable per-check details"
- [ ] "Each check shows base-branch evidence and confidence level (high/medium/low)"
- [ ] "When all checks pass, no CI comment is posted (no noise on clean PRs)"
- [ ] "When no base-branch check data exists, the CI annotation is skipped entirely"
- [ ] "The handler does not modify merge confidence or block approval — it is completely independent of the review pipeline"
- [ ] "Each check_suite.completed event records check run data into ci_check_history for flakiness tracking"
- [ ] "Multiple check_suite events for the same SHA produce idempotent results (re-fetch all checks, rebuild section)"

## Files

- `src/lib/ci-failure-formatter.ts`
- `src/handlers/ci-failure.ts`
- `src/index.ts`
