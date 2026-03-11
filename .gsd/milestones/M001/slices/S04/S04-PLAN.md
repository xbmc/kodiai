# S04: Pr Auto Review

**Goal:** Extend the repo config schema with review-specific fields (skipAuthors, skipPaths, custom prompt) and create a dedicated review prompt builder that instructs Claude to post inline comments with suggestion blocks for issues and do nothing for clean PRs.
**Demo:** Extend the repo config schema with review-specific fields (skipAuthors, skipPaths, custom prompt) and create a dedicated review prompt builder that instructs Claude to post inline comments with suggestion blocks for issues and do nothing for clean PRs.

## Must-Haves


## Tasks

- [x] **T01: 04-pr-auto-review 01** `est:2min`
  - Extend the repo config schema with review-specific fields (skipAuthors, skipPaths, custom prompt) and create a dedicated review prompt builder that instructs Claude to post inline comments with suggestion blocks for issues and do nothing for clean PRs.

Purpose: The review prompt is the core of the review quality -- it tells Claude exactly what to look for, how to report findings (inline comments with suggestion blocks), and to stay silent on clean PRs. The config extensions let repo owners customize review behavior (skip bot authors, ignore certain paths, add custom instructions).

Output: Extended `RepoConfig` type with review fields, `buildReviewPrompt()` function, updated tests.
- [x] **T02: 04-pr-auto-review 02** `est:3min`
  - Create the review handler that wires `pull_request.opened` and `pull_request.ready_for_review` events to the execution engine, with fork PR support, base branch fetching, silent approval logic, and server wiring.

Purpose: This is the core feature of Phase 4. When a PR is opened (or a draft becomes ready), the handler clones the repo, builds a review-specific prompt, runs Claude via the executor, and submits a silent approval if Claude found no issues. Fork PRs are handled natively by cloning from head.repo.

Output: `src/handlers/review.ts` (review handler factory), updated `src/index.ts` (wiring).

## Files Likely Touched

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `src/index.ts`
