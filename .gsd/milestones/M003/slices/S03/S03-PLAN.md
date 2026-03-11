# S03: Enhanced Config Fields

**Goal:** Add `allowedUsers` field to mention config and upgrade `skipPaths` matching to picomatch globs.
**Demo:** Add `allowedUsers` field to mention config and upgrade `skipPaths` matching to picomatch globs.

## Must-Haves


## Tasks

- [x] **T01: 24-enhanced-config-fields 01** `est:4min`
  - Add `allowedUsers` field to mention config and upgrade `skipPaths` matching to picomatch globs.

Purpose: CONFIG-07 (mention allowlist) and CONFIG-04 upgrade (picomatch glob matching) complete the user-facing review/mention controls.
Output: Updated config schema, mention handler with user gating, review handler with picomatch skipPaths.
- [x] **T02: 24-enhanced-config-fields 02** `est:6min`
  - Add telemetry config section with opt-out control and cost warning threshold.

Purpose: CONFIG-10 (telemetry opt-out) and CONFIG-11 (cost warning) give repo owners control over telemetry collection and cost visibility.
Output: New telemetry schema section, conditional telemetry recording in both handlers, cost warning comment logic.

## Files Likely Touched

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/jobs/workspace.test.ts  # read-only: verify pre-existing CONFIG-08/09 tests pass`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
