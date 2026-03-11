# T02: 62-issue-write-mode-pr-creation 02

**Slice:** S03 — **Milestone:** M011

## Description

Lock IWR-01 behavior with deterministic tests so issue write-mode PR creation and issue-thread PR-link replies remain stable across future handler changes.

Purpose: Phase 62 success depends on runtime behavior under issue_comment events; dedicated tests prevent regressions back to PR-context-only write handling.
Output: Mention handler tests that prove issue write-mode opens PRs against default branch, includes commits when changes exist, and posts clear refusal replies when changes are absent.

## Must-Haves

- [ ] "Issue `@kodiai apply:` / `@kodiai change:` with write enabled produces an issue-thread PR link reply"
- [ ] "Created issue write-mode PR targets the repository default branch"
- [ ] "When issue write-mode cannot safely produce changes, the issue reply is a clear refusal instead of silent success"

## Files

- `src/handlers/mention.test.ts`
