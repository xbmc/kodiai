# S01: Config Validation Safety

**Goal:** Make .
**Demo:** Make .

## Must-Haves


## Tasks

- [x] **T01: 22-config-validation-safety 01** `est:4min`
  - Make .kodiai.yml parsing forward-compatible and failure-resilient by removing `.strict()` from all sub-schemas and implementing section-level graceful degradation with structured warnings.

Purpose: Repos should never break when Kodiai adds new config capabilities. A typo in one config section should not prevent the rest from working.
Output: Updated `config.ts` with two-pass safeParse, updated return type `LoadConfigResult`, updated call sites in 3 handlers, updated and expanded test suite.

## Files Likely Touched

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/execution/executor.ts`
