# S03: Smart Finding Prioritization

**Goal:** Build a pure, deterministic finding prioritization engine with TDD so Phase 44 can enforce multi-factor ranking independent of model output order.
**Demo:** Build a pure, deterministic finding prioritization engine with TDD so Phase 44 can enforce multi-factor ranking independent of model output order.

## Must-Haves


## Tasks

- [x] **T01: 44-smart-finding-prioritization 01** `est:2min`
  - Build a pure, deterministic finding prioritization engine with TDD so Phase 44 can enforce multi-factor ranking independent of model output order.

Purpose: Requirement PRIOR-01/02 depends on reliable post-LLM prioritization logic that can be tested in isolation and reused by the review handler.

Output: `src/lib/finding-prioritizer.ts` and `src/lib/finding-prioritizer.test.ts` with RED-GREEN coverage for scoring, sorting, and capped selection behavior.
- [x] **T02: 44-smart-finding-prioritization 02** `est:2min`
  - Wire the Phase 44 prioritization engine into live review execution so comment caps are enforced by composite score with configurable weights and transparent reporting.

Purpose: This closes PRIOR-01 through PRIOR-04 in runtime behavior, ensuring deterministic high-value comment selection when findings exceed profile caps.

Output: Config support for prioritization weights, handler-level prioritization enforcement, and regression coverage for scoring/cap/disclosure behavior.

## Files Likely Touched

- `src/lib/finding-prioritizer.ts`
- `src/lib/finding-prioritizer.test.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
