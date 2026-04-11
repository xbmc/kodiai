# S03: Integrated M047 coherence verifier — UAT

**Milestone:** M047
**Written:** 2026-04-11T03:18:31.515Z

# S03 UAT — Integrated M047 coherence verifier

**Milestone:** M047  
**Written:** 2026-04-10

## Preconditions

- Repository is at the completed M047/S03 state.
- Dependencies are installed and `bun` is available.
- No live Slack, GitHub, or database credentials are required; the verifier is deterministic and composes existing proof surfaces.
- The prerequisite proof commands `verify:m047:s02`, `verify:m045:s03`, and `verify:m046` are available via `package.json` scripts.

## Test Case 1 — The dedicated integrated verifier regression suite stays green

1. Run:
   - `bun test ./scripts/verify-m047.test.ts`
2. Confirm the command exits 0.
3. Confirm the output reports 5 passing tests and 0 failures.
4. Confirm the passing cases include:
   - stable exported check ids and milestone scenario ids
   - nested report preservation across S02/M045/M046
   - malformed nested-report and missing-anchor failures
   - opt-out continuity leak detection
   - human/JSON output alignment plus `package.json` wiring

**Expected outcome:**
- The milestone-close harness contract is regression-locked and fails loudly on false-green drift.

## Test Case 2 — `verify:m047 -- --json` exposes the full milestone scenario matrix

1. Run:
   - `bun run verify:m047 -- --json`
2. Confirm the command exits 0.
3. Confirm the top-level JSON report includes these check ids:
   - `M047-S03-S02-REPORT-COMPOSED`
   - `M047-S03-M045-REPORT-COMPOSED`
   - `M047-S03-M046-REPORT-COMPOSED`
   - `M047-S03-MILESTONE-SCENARIOS`
4. Confirm the scenario list contains exactly:
   - `linked-unscored`
   - `calibrated-retained`
   - `stale-degraded`
   - `opt-out`
   - `coarse-fallback`
5. Confirm nested `s02`, `m045`, and `m046` objects are preserved in the JSON output.

**Expected outcome:**
- The milestone proof surface is machine-consumable and exposes one canonical assembled report instead of separate ad hoc verifier outputs.

## Test Case 3 — Each milestone scenario anchors the right evidence

1. Inspect the JSON from `bun run verify:m047 -- --json`.
2. Confirm these scenario-specific expectations:
   - `linked-unscored` resolves runtime/retrieval surfaces as coarse fallback and does **not** claim active linked Slack/profile guidance.
   - `calibrated-retained` stays `profile-backed` and anchors contributor-model evidence on `koprajs`.
   - `stale-degraded` stays degraded and anchors contributor-model freshness evidence on `fkoemep`.
   - `opt-out` stays generic-opt-out across runtime, retrieval, Slack/profile, and identity surfaces.
   - `coarse-fallback` marks Slack/profile continuity as `not_applicable` instead of inventing linked-profile evidence.
3. Confirm the embedded M046 verdict block reports `replace` as data while `overallPassed` remains true.

**Expected outcome:**
- The assembled matrix proves cross-surface coherence honestly, including truthful `not_applicable` and verdict-as-data handling.

## Test Case 4 — Prerequisite proof surfaces still agree with the integrated verifier

1. Run:
   - `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`
2. Confirm the combined command exits 0.
3. Confirm:
   - `verify:m047:s02` reports downstream stored-profile, retrieval, Slack/profile, and identity alignment.
   - `verify:m045:s03` stays green for contract drift across review, retrieval, Slack, and identity surfaces.
   - `verify:m046` stays green while still reporting the `replace` recommendation and M047 change contract.

**Expected outcome:**
- The top-level verifier composes three healthy prerequisite proof surfaces rather than masking upstream breakage.

## Test Case 5 — Invalid CLI args fail loudly instead of falling through

1. Run:
   - `bun run verify:m047 -- --bogus`
2. Confirm the command exits non-zero.
3. Confirm stderr/stdout surfaces a clear invalid-argument failure instead of printing a pass report.

**Expected outcome:**
- Operator misuse cannot produce a false green.

## Test Case 6 — Type safety still holds after the composition wiring

1. Run:
   - `bun run tsc --noEmit`
2. Confirm the command exits 0.

**Expected outcome:**
- The integrated verifier, regression suite, and package script wiring compile cleanly.

## Edge Cases To Explicitly Check

- The opt-out scenario must fail if linked continuity evidence reappears on the Slack/profile surface.
- The coarse-fallback scenario must report Slack/profile continuity as `not_applicable`, not as pass-by-invention.
- Missing or malformed nested S02/M045/M046 reports must fail the milestone harness instead of skipping silently.
- The integrated report must preserve nested JSON objects verbatim so downstream tooling can drill into upstream evidence without recomputation.
- The embedded M046 `replace` verdict must remain machine-readable data and must **not** flip the harness into failure by itself.

## UAT Exit Criteria

S03 is accepted only if:

- `bun test ./scripts/verify-m047.test.ts` passes,
- `bun run verify:m047 -- --json` passes and exposes the five scenario ids plus four stable top-level checks,
- the prerequisite verifier bundle passes unchanged,
- invalid CLI args fail loudly,
- `bun run tsc --noEmit` passes,
- and no edge-case check allows forbidden opt-out continuity or fabricated coarse-fallback Slack/profile evidence.
