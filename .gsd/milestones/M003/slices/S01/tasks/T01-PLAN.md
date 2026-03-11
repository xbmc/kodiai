# T01: 22-config-validation-safety 01

**Slice:** S01 — **Milestone:** M003

## Description

Make .kodiai.yml parsing forward-compatible and failure-resilient by removing `.strict()` from all sub-schemas and implementing section-level graceful degradation with structured warnings.

Purpose: Repos should never break when Kodiai adds new config capabilities. A typo in one config section should not prevent the rest from working.
Output: Updated `config.ts` with two-pass safeParse, updated return type `LoadConfigResult`, updated call sites in 3 handlers, updated and expanded test suite.

## Must-Haves

- [ ] "A .kodiai.yml with unknown keys (e.g. futureFeature: true) is accepted without error and unknown keys are silently ignored"
- [ ] "A .kodiai.yml with a valid review section but invalid write section loads the valid review config and falls back to defaults for write, with a warning logged"
- [ ] "A repo with no .kodiai.yml works with all defaults (zero-config preserved)"
- [ ] "When a section falls back to defaults due to validation error, a warning is returned identifying which section failed and why"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/execution/executor.ts`
