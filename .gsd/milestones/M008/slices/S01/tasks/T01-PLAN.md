# T01: 42-commit-message-keywords-pr-intent 01

**Slice:** S01 — **Milestone:** M008

## Description

Implement the PR intent parser as a pure function with comprehensive test coverage using TDD.

Purpose: Create the core parsing engine that extracts structured review intent signals from PR metadata (title bracket tags, conventional commit prefixes, breaking change keywords, commit message scanning). This is a pure function with zero side effects -- no API calls, no I/O.

Output: `src/lib/pr-intent-parser.ts` (parser + types + section builder) and `src/lib/pr-intent-parser.test.ts` (tests).

## Must-Haves

- [ ] "Bracket tags like [WIP], [no-review], [security-review], [style-ok] are extracted from PR title (case-insensitive, any position)"
- [ ] "Unrecognized bracket tags are detected and separated from recognized ones"
- [ ] "Conventional commit prefixes (feat:, fix:, docs:, etc.) are parsed from PR title"
- [ ] "Breaking change keywords are detected in PR body (outside code blocks) and commit messages"
- [ ] "When multiple profile tags conflict, the most strict wins (strict > balanced > minimal)"
- [ ] "For 50+ commits, strategic sampling selects first 10, last 10, and every 5th in between"
- [ ] "[no-review] sets noReview: true, [style-ok] sets styleOk: true, [WIP] sets isWIP: true"

## Files

- `src/lib/pr-intent-parser.ts`
- `src/lib/pr-intent-parser.test.ts`
