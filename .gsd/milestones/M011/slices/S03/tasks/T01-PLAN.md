# T01: 62-issue-write-mode-pr-creation 01

**Slice:** S03 — **Milestone:** M011

## Description

Enable issue-surface write-mode so explicit `@kodiai apply:` / `@kodiai change:` requests can publish changes and open a PR against the default branch when write-mode is enabled.

Purpose: IWR-01 requires issue comment write intent to produce a real PR flow (not PR-context-only refusal) while preserving Phase 61 read-only safeguards for non-prefixed issue comments.
Output: Mention handler logic that supports issue write-output keys/branches, creates issue-triggered PRs against the default branch, and replies in-thread with the resulting PR URL.

## Must-Haves

- [ ] "Issue comments with explicit apply/change intent enter write-mode when write.enabled is true"
- [ ] "A write-mode issue request creates a PR that targets the repository default branch"
- [ ] "After PR creation, Kodiai posts a single issue-thread reply with the created PR link"

## Files

- `src/handlers/mention.ts`
