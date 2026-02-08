---
status: testing
phase: 09-review-ux-improvements
source: 09-01-SUMMARY.md, 09-02-SUMMARY.md
started: 2026-02-08T19:31:00Z
updated: 2026-02-08T19:59:00Z
---

## Current Test

number: 4
name: PR summary comment appears first
expected: |
  When a PR is opened or marked ready for review, kodiai posts a structured summary comment FIRST (before any inline review comments) showing "What changed", "Why", and "Files modified" sections. The summary appears at the top of the PR conversation timeline.
awaiting: user response

## Tests

### 1. Eyes emoji reaction on mention trigger
expected: When you @mention kodiai in a GitHub issue comment, PR comment, or PR review comment, the trigger comment receives an eyes emoji reaction within seconds (before the tracking comment appears). PR review bodies are skipped (review ID is not a comment ID).
result: pass

### 2. Long response collapsing (mention)
expected: When kodiai responds to a mention with a response longer than 500 characters, the entire response is wrapped in `<details>` tags with a summary line showing the collapsed content length. Short responses (under 500 characters) are NOT wrapped.
result: skipped
reason: Waiting for mention response to complete

### 3. Error comment collapsing
expected: When kodiai encounters an error and posts an error comment (execution failure, timeout, etc.), long error messages (over 500 chars) are wrapped in `<details>` tags with summary "Kodiai encountered an error". Short error messages pass through unwrapped.
result: skipped
reason: Would require triggering an error

### 4. PR summary comment appears first
expected: When a PR is opened or marked ready for review, kodiai posts a structured summary comment FIRST (before any inline review comments) showing "What changed", "Why", and "Files modified" sections. The summary appears at the top of the PR conversation timeline.
result: issue
reported: "Summary comment posts even when there are no issues to fix (just noise). Should only post when there are actionable items. Also needs to be collapsed in <details> tags. Also need eyes reaction on initial PR interaction. Also tracking comment should be collapsed like mention tracking comment."
severity: major

### 5. Trivial PR summary
expected: For trivial PRs (fewer than 3 files AND under 50 lines changed), the summary comment is short (2-3 lines) instead of the full what/why/files structure.
result: issue
reported: "Don't need trivial PR detection - just don't post summary at all unless there are actionable issues"
severity: minor

### 6. Long PR summary collapsing
expected: For PRs where the summary comment would exceed 500 characters, the summary is wrapped in `<details>` tags with summary "PR Summary".
result: issue
reported: "ALL comments should be collapsed in <details> tags, not just long ones"
severity: major

## Summary

total: 6
passed: 1
issues: 3
pending: 0
skipped: 2

## Gaps

- truth: "PR auto-review only posts comments when there are actionable items (bugs/improvements/fixes to suggest)"
  status: failed
  reason: "User reported: Summary comment posts even when there are no issues to fix (just noise). Should only post when there are actionable items."
  severity: major
  test: 4

- truth: "All bot comments on PRs are collapsed in <details> tags for reduced noise"
  status: failed
  reason: "User reported: ALL comments should be collapsed in <details> tags, not just long ones"
  severity: major
  test: 6

- truth: "PR auto-review adds eyes emoji reaction to the PR description (issue body) immediately when PR is opened"
  status: failed
  reason: "User reported: eyes can be posted on initial message (PR description) using createForIssue API"
  severity: major
  test: 4
  artifacts:
    - path: "src/handlers/review.ts"
      issue: "Missing eyes reaction call to PR issue body before review starts"

- truth: "Bot properly uses GitHub review API with APPROVE status when no issues found"
  status: failed
  reason: "User reported: add as a reviewer and if it passes, mark it as a checkmark"
  severity: major
  test: 4
