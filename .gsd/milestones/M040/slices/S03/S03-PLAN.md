# S03: Bounded Prompt Integration, Bypass, and Validation Gate

**Goal:** Finish the operational shape: bounded prompt packing, trivial-change bypass, optional validation for graph-amplified findings, and fail-open execution.
**Demo:** After this: After this, a large C++ or Python PR gets a bounded graph context section and optional second-pass validation for graph-amplified findings, while a trivial PR bypasses graph overhead cleanly.

## Tasks
- [x] **T01: Add buildGraphContextSection() for bounded graph prompt packing and wire it into buildReviewPrompt() via graphBlastRadius param; 203 tests pass** — - Add a bounded graph-context section to the review prompt for impacted files, tests, and dependency chains.
- Pack graph evidence by rank and cap size so blast radius never becomes a raw dump.
- Add tests for prompt rendering and bounded packing behavior.
  - Estimate: 0.5-1d
  - Files: src/execution/review-prompt.ts, src/execution/review-prompt.test.ts, src/review-graph/prompt-context.ts
  - Verify: bun test ./src/execution/review-prompt.test.ts
- [x] **T02: Add isTrivialChange() bypass and validateGraphAmplifiedFindings() gate; wire both into review handler fail-open; 24 new tests pass, 235 total pass, tsc clean** — - Implement trivial-change bypass and optional second-pass validation for graph-amplified findings.
- Keep both behaviors configurable and fail-open.
- Wire the handler so graph or validation failure never blocks review completion.
  - Estimate: 1d
  - Files: src/handlers/review.ts, src/review-graph/validation.ts, src/review-graph/validation.test.ts
  - Verify: bun test ./src/review-graph/validation.test.ts && bun run tsc --noEmit
- [ ] **T03: Add boundedness and fail-open verifier** — - Add the milestone-level verifier for large-PR graph use and small-PR bypass.
- Cover bounded prompt context, fail-open behavior, and optional validation outcomes.
- Emit machine-checkable proof output that can close M040 without hand inspection.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m040-s03.ts, scripts/verify-m040-s03.test.ts, src/review-graph/prompt-context.ts, src/review-graph/validation.ts, src/handlers/review.ts
  - Verify: bun test ./scripts/verify-m040-s03.test.ts && bun run verify:m040:s03 -- --json
