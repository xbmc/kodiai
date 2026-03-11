# T01: 04-pr-auto-review 01

**Slice:** S04 — **Milestone:** M001

## Description

Extend the repo config schema with review-specific fields (skipAuthors, skipPaths, custom prompt) and create a dedicated review prompt builder that instructs Claude to post inline comments with suggestion blocks for issues and do nothing for clean PRs.

Purpose: The review prompt is the core of the review quality -- it tells Claude exactly what to look for, how to report findings (inline comments with suggestion blocks), and to stay silent on clean PRs. The config extensions let repo owners customize review behavior (skip bot authors, ignore certain paths, add custom instructions).

Output: Extended `RepoConfig` type with review fields, `buildReviewPrompt()` function, updated tests.

## Must-Haves

- [ ] "Review config schema accepts skipAuthors, skipPaths, and prompt fields with sensible defaults"
- [ ] "Review prompt instructs Claude to use inline comments with suggestion blocks for issues"
- [ ] "Review prompt instructs Claude to do nothing if no issues found (silent approval handled by handler)"
- [ ] "Review prompt includes PR metadata (title, author, branches, changed files, custom instructions)"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/execution/review-prompt.ts`
