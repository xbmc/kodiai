---
estimated_steps: 4
estimated_files: 2
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Compose the milestone-close `verify:m047` proof harness

**Slice:** S03 — Integrated M047 coherence verifier
**Milestone:** M047

## Description

Build the milestone-close proof harness as a pure composition layer. Reuse `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()` as the only evidence sources, preserve their nested reports verbatim, and keep coarse-fallback honest by marking Slack/profile continuity not applicable rather than inventing a fake linked-profile surface.

## Steps

1. Create `scripts/verify-m047.ts` with stable exported check ids/types, a small CLI arg parser, and nested-report validation helpers for the S02, M045, and M046 prerequisite reports.
2. Compose the five milestone scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`) from nested evidence only, anchoring calibrated-retained on `koprajs` and stale-degraded on `fkoemep`.
3. Render both human and JSON output, preserve the full nested S02/M045/M046 report objects in the top-level payload, and keep the truthful M046 `replace` verdict as data instead of turning it into a harness failure.
4. Wire `verify:m047` into `package.json` and smoke-check the new command with `bun run verify:m047 -- --json`.

## Must-Haves

- [ ] `scripts/verify-m047.ts` composes `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()` directly and does not re-run S01 or lower-level contributor logic on its own.
- [ ] The top-level report emits stable check ids plus the five milestone scenario ids with explicit not-applicable handling for coarse-fallback Slack/profile continuity.
- [ ] `bun run verify:m047 -- --json` returns nested S02, M045, and M046 evidence and exits non-zero only for malformed or failed proof surfaces, invalid args, or scenario drift.

## Verification

- `bun run verify:m047 -- --json`
- `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`

## Observability Impact

- Signals added/changed: `verify:m047` becomes the milestone-close JSON and human inspection surface with stable top-level check ids, scenario ids, and failure status codes.
- How a future agent inspects this: run `bun run verify:m047 -- --json` and compare the nested S02, M045, and M046 payloads plus scenario summaries.
- Failure state exposed: malformed nested reports, prerequisite proof failures, missing scenario anchors, or false-green composition drift show up as named failing checks instead of silent report gaps.

## Inputs

- `scripts/verify-m047-s02.ts` — authoritative downstream stored-profile proof surface that already embeds S01 evidence.
- `scripts/verify-m045-s03.ts` — contributor-experience contract drift guard that must stay nested and intact.
- `scripts/verify-m046.ts` — calibration verdict and `m047ChangeContract` proof surface for contributor-model evidence.
- `package.json` — canonical package-script entrypoint list that must gain `verify:m047`.

## Expected Output

- `scripts/verify-m047.ts` — new milestone-close composition harness with stable check ids, scenario mapping, and CLI output.
- `package.json` — `verify:m047` script wiring for operator and regression use.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `evaluateM047S02()` | Fail the top-level proof with a named prerequisite check instead of emitting a partial green milestone report. | Keep the existing bounded local verifier behavior; do not add retries or polling loops. | Reject missing scenario/check fields and fail composition before milestone scenario mapping runs. |
| `evaluateM045S03()` | Fail the top-level proof and surface the M045 contract guard as an unavailable or failing prerequisite. | Keep the existing bounded local verifier behavior; no custom timeout handling beyond the nested harness. | Treat missing retrieval, Slack, or identity sections as malformed evidence rather than silently dropping R046 coverage. |
| `evaluateM046()` | Fail the top-level proof if the verdict/report is missing or contradictory. | Keep the existing bounded local verifier behavior; no retry loops. | Reject missing verdict or `m047ChangeContract` fields instead of silently omitting contributor-model evidence. |
| `process.argv` / CLI args | Exit non-zero with an invalid-arg error for unsupported flags. | N/A | Accept only the documented `--json` switch and fail closed on anything else. |

## Load Profile

- **Shared resources**: local Bun process memory, nested verifier report objects, and stdout/stderr output.
- **Per-operation cost**: one evaluation each of `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()` plus five milestone scenario compositions.
- **10x breakpoint**: report size and repeated nested proof execution become noisy before compute does, so scenario count, check ids, and preserved nested evidence must stay bounded and deterministic.

## Negative Tests

- **Malformed inputs**: nested reports missing required `command`, `overallPassed`, `checks`, `scenarios`, `verdict`, or `m047ChangeContract` fields; unknown CLI flags.
- **Error paths**: `evaluateM047S02()`, `evaluateM045S03()`, or `evaluateM046()` throws; a nested report returns `overallPassed: false`; contributor-model evidence is missing for `calibrated-retained` or `stale-degraded`.
- **Boundary conditions**: `coarse-fallback` must mark Slack/profile continuity not applicable instead of inventing a linked-profile surface; `calibrated-retained` should anchor on `koprajs`; `stale-degraded` should anchor on `fkoemep`; `opt-out` must preserve identity-suppression evidence.
