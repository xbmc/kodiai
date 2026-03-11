# S03: Issue Write Mode Pr Creation

**Goal:** Enable issue-surface write-mode so explicit `@kodiai apply:` / `@kodiai change:` requests can publish changes and open a PR against the default branch when write-mode is enabled.
**Demo:** Enable issue-surface write-mode so explicit `@kodiai apply:` / `@kodiai change:` requests can publish changes and open a PR against the default branch when write-mode is enabled.

## Must-Haves


## Tasks

- [x] **T01: 62-issue-write-mode-pr-creation 01** `est:2 min`
  - Enable issue-surface write-mode so explicit `@kodiai apply:` / `@kodiai change:` requests can publish changes and open a PR against the default branch when write-mode is enabled.

Purpose: IWR-01 requires issue comment write intent to produce a real PR flow (not PR-context-only refusal) while preserving Phase 61 read-only safeguards for non-prefixed issue comments.
Output: Mention handler logic that supports issue write-output keys/branches, creates issue-triggered PRs against the default branch, and replies in-thread with the resulting PR URL.
- [x] **T02: 62-issue-write-mode-pr-creation 02** `est:1 min`
  - Lock IWR-01 behavior with deterministic tests so issue write-mode PR creation and issue-thread PR-link replies remain stable across future handler changes.

Purpose: Phase 62 success depends on runtime behavior under issue_comment events; dedicated tests prevent regressions back to PR-context-only write handling.
Output: Mention handler tests that prove issue write-mode opens PRs against default branch, includes commits when changes exist, and posts clear refusal replies when changes are absent.
- [x] **T03: 62-issue-write-mode-pr-creation 03** `est:0 min`
  - Close the Phase 62 production gaps by fixing real issue-comment write-intent classification and proving that accepted issue requests create a default-branch PR with an in-thread `Opened PR` response.

Purpose: Verification found code-level coverage but failed live behavior, so this plan restores production truth for IWR-01 with fixture parity and live-evidence validation.
Output: Mention handler/runtime tests updated to match real webhook payload shape, plus validated live issue evidence showing trigger comment, bot PR-link reply, and created PR URL.

## Files Likely Touched

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
