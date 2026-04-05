# S02: Structural Impact Rendering and Review Flow Integration

**Goal:** Turn the combined structural-impact payload into user-visible review output and breaking-change evidence in the main review flow.
**Demo:** After this: After this, a large C++ or Python review shows a bounded Structural Impact section in Review Details and uses structural evidence to strengthen breaking-change output.

## Tasks
- [x] **T01: Added a bounded Structural Impact formatter for Review Details with truthful confidence wording, truncation metadata, and focused formatter tests.** — - Implement Structural Impact formatting for Review Details using bounded caller/dependent/file/test summaries plus unchanged-code evidence.
- Keep confidence language truthful for probable vs stronger graph evidence.
- Add formatter tests for bounded output and truncation behavior.
  - Estimate: 0.5-1d
  - Files: src/lib/structural-impact-formatter.ts, src/lib/structural-impact-formatter.test.ts, src/lib/review-utils.ts
  - Verify: bun test ./src/lib/structural-impact-formatter.test.ts && bun run tsc --noEmit
- [x] **T02: Integrated Structural Impact into review prompts and Review Details with explicit breaking-change evidence and fallback guidance.** — - Wire structural-impact rendering into the main review flow and Review Details generation.
- Use structural evidence to strengthen breaking-change output when caller/dependent data is present.
- Preserve fallback behavior when structural-impact data is absent or partial.
  - Estimate: 1d
  - Files: src/handlers/review.ts, src/execution/review-prompt.ts, src/execution/review-prompt.test.ts, src/lib/review-utils.ts
  - Verify: bun test ./src/execution/review-prompt.test.ts
- [x] **T03: Added a fixture-based structural-impact verifier for C++ and Python review rendering with stable JSON proof output and a new verify:m038:s02 script.** — - Add a fixture-based verifier for C++ and Python review scenarios.
- Prove Review Details shows a bounded Structural Impact section and uses structural evidence for breaking-change wording when available.
- Keep proof output stable and machine-checkable.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m038-s02.ts, scripts/verify-m038-s02.test.ts, src/lib/structural-impact-formatter.ts, src/structural-impact/orchestrator.ts
  - Verify: bun test ./scripts/verify-m038-s02.test.ts && bun run verify:m038:s02 -- --json
