# S03: Pr Issue Linking

**Goal:** Create the two core modules for PR-issue linking: a pure regex-based reference parser and an orchestrator that resolves parsed references to issue records with semantic search fallback.
**Demo:** Create the two core modules for PR-issue linking: a pure regex-based reference parser and an orchestrator that resolves parsed references to issue records with semantic search fallback.

## Must-Haves


## Tasks

- [x] **T01: 108-pr-issue-linking 01** `est:4 min`
  - Create the two core modules for PR-issue linking: a pure regex-based reference parser and an orchestrator that resolves parsed references to issue records with semantic search fallback.

Purpose: Provide fully tested, isolated building blocks that Plan 02 will wire into the review handler. By keeping the parser pure (zero I/O) and the linker as a thin orchestrator, both are independently testable.

Output: Tested issue-reference-parser module, tested issue-linker module.
- [x] **T02: 108-pr-issue-linking 02** `est:3 min`
  - Wire PR-issue linking into the review pipeline: extend buildReviewPrompt with a linked issues section, call linkPRToIssues in review.ts, and inject issueStore into the review handler's dependencies.

Purpose: This connects the building blocks from Plan 01 into the live review flow so that every PR review prompt is enriched with linked issue context when available.

Output: Extended review prompt builder, wired review handler, updated index.ts dependency injection.

## Files Likely Touched

- `src/lib/issue-reference-parser.ts`
- `src/lib/issue-reference-parser.test.ts`
- `src/knowledge/issue-linker.ts`
- `src/knowledge/issue-linker.test.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `src/index.ts`
