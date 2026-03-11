# T02: 04-pr-auto-review 02

**Slice:** S04 — **Milestone:** M001

## Description

Create the review handler that wires `pull_request.opened` and `pull_request.ready_for_review` events to the execution engine, with fork PR support, base branch fetching, silent approval logic, and server wiring.

Purpose: This is the core feature of Phase 4. When a PR is opened (or a draft becomes ready), the handler clones the repo, builds a review-specific prompt, runs Claude via the executor, and submits a silent approval if Claude found no issues. Fork PRs are handled natively by cloning from head.repo.

Output: `src/handlers/review.ts` (review handler factory), updated `src/index.ts` (wiring).

## Must-Haves

- [ ] "pull_request.opened event (non-draft) triggers a review execution"
- [ ] "pull_request.ready_for_review event triggers a review execution"
- [ ] "Draft PRs on opened event are silently skipped"
- [ ] "Fork PRs clone from head.repo for code, post comments to base repo"
- [ ] "Base branch is fetched after clone so git diff origin/base...HEAD works"
- [ ] "After successful execution with no inline comments, a silent APPROVE review is submitted"
- [ ] "After successful execution with inline comments, no approval is submitted"
- [ ] "skipAuthors in config causes matching PR authors to be skipped"
- [ ] "review.enabled=false in config causes the review to be skipped"
- [ ] "Deleted fork repos (head.repo null) fall back to git fetch origin pull/N/head"

## Files

- `src/handlers/review.ts`
- `src/index.ts`
