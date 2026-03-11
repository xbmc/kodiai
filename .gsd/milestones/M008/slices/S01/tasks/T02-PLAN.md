# T02: 42-commit-message-keywords-pr-intent 02

**Slice:** S01 — **Milestone:** M008

## Description

Wire the PR intent parser into the review handler pipeline, including commit message fetching, [no-review] skip logic, keyword-driven overrides, and Review Details transparency output.

Purpose: Connect the pure parser (Plan 01) to the live review pipeline so keyword signals actually influence review behavior. This is the integration glue that makes the parser useful.

Output: Modified `src/handlers/review.ts` (integration) and `src/execution/review-prompt.ts` (conventional commit context).

## Must-Haves

- [ ] "[no-review] in PR title causes the bot to skip review entirely with an acknowledgment comment"
- [ ] "Commit messages are fetched via GitHub API and passed to parsePRIntent"
- [ ] "Keyword-based profile override applies after config profile (most strict wins)"
- [ ] "[style-ok] adds 'style' to ignored areas additively"
- [ ] "[security-review] adds 'security' to focus areas"
- [ ] "Keyword parsing results appear in Review Details appendix"
- [ ] "Unrecognized bracket tags are displayed in Review Details so users know which keywords were ignored"
- [ ] "Parser failure is fail-open -- review proceeds without keywords"
- [ ] "[no-review] fast check happens before workspace creation for performance"

## Files

- `src/handlers/review.ts`
- `src/execution/review-prompt.ts`
