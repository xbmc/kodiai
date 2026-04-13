---
id: T01
parent: S03
milestone: M048
key_files:
  - src/execution/config.ts
  - src/execution/config.test.ts
  - src/handlers/review.test.ts
  - src/handlers/review.ts
  - src/handlers/mention.ts
  - src/execution/executor.ts
  - .kodiai.yml
  - docs/configuration.md
key_decisions:
  - Kept legacy `review.onSynchronize` disabled and emitted an explicit compatibility warning instead of auto-mapping it to enabled behavior.
  - Standardized config-warning logging to a generic message so compatibility warnings stay operator-truthful across review, mention, and executor paths.
duration: 
verification_result: mixed
completed_at: 2026-04-13T03:50:58.591Z
blocker_discovered: false
---

# T01: Added fail-loud legacy synchronize config warnings and restored nested synchronize trigger continuity through review handler gating.

**Added fail-loud legacy synchronize config warnings and restored nested synchronize trigger continuity through review handler gating.**

## What Happened

I started with a TDD pass by adding config coverage for three cases: legacy top-level `review.onSynchronize`, the supported nested `review.triggers.onSynchronize`, and malformed non-boolean synchronize values. I also added review-handler coverage proving that `pull_request.synchronize` runs only when the effective parsed trigger is enabled, not when raw YAML merely contains the legacy key.

The root cause was in `loadRepoConfig`: Zod’s object parsing stripped unknown keys during the fast path, so legacy `review.onSynchronize` silently disappeared and the effective trigger stayed at the default `false` with no warning. I fixed that by inspecting the raw parsed YAML for the legacy key and appending a compatibility warning that explicitly reports the ignored legacy path, the effective nested trigger value, and the supported replacement key. I preserved current runtime semantics: the legacy key does not auto-enable synchronize reviews, it now fails loudly instead of false-greening.

To make the operator surface truthful, I updated the warning log text in the review handler, mention handler, and executor from the overly specific “Config section invalid, using defaults” to the more accurate “Config warning detected”, so compatibility warnings for otherwise-valid configs are not misleading. I then updated the checked-in `.kodiai.yml` to the nested `review.triggers.onSynchronize: true` shape and documented that nested form in `docs/configuration.md`, including a note that the legacy top-level key is ignored and warned.

Finally, I verified the checked-in repo config now parses with synchronize effectively enabled, and the new handler tests prove the live review path uses the effective parsed trigger state end-to-end.

## Verification

Task-level verification passed: `bun test ./src/execution/config.test.ts ./src/handlers/review.test.ts` passed with the new parser and synchronize-gating coverage, and `bun run tsc --noEmit` passed cleanly.

Slice-level verification status for this intermediate task: the broader slice test command passed against the currently present slice test files, but both `verify:m048:s03` commands failed because the verifier script is not implemented yet in this slice and is scheduled for T03.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/execution/config.test.ts ./src/handlers/review.test.ts` | 0 | ✅ pass | 5431ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 8186ms |
| 3 | `bun test ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s03.test.ts` | 0 | ✅ pass | 3937ms |
| 4 | `bun run verify:m048:s03 -- --json` | 1 | ❌ fail | 15ms |
| 5 | `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` | 1 | ❌ fail | 2ms |

## Deviations

Broadened the shared warning log message in `src/handlers/review.ts`, `src/handlers/mention.ts`, and `src/execution/executor.ts` from “Config section invalid, using defaults” to “Config warning detected” so the new legacy-key compatibility warning is truthful even when the rest of the config is valid.

## Known Issues

`verify:m048:s03` is not present yet, so both slice verifier commands currently fail with `Script not found \"verify:m048:s03\"`. That is expected remaining slice work for T03, not a blocker for T01.

## Files Created/Modified

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.test.ts`
- `src/handlers/review.ts`
- `src/handlers/mention.ts`
- `src/execution/executor.ts`
- `.kodiai.yml`
- `docs/configuration.md`
