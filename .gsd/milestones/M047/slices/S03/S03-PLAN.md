# S03: Integrated M047 coherence verifier

**Goal:** Ship the milestone-level `verify:m047` proof surface that composes the already-shipped M047/S02 downstream truth, M045 contract-drift evidence, and M046 calibration evidence into one operator-facing coherence verifier without reopening product logic.
**Demo:** `bun run verify:m047 -- --json` passes and shows linked-unscored, calibrated-retained, stale/degraded, opt-out, and coarse-fallback scenarios resolving consistently across review, Review Details, retrieval hints, Slack/profile output, and contributor-model plumbing while preserving nested M045/M046 evidence.

## Must-Haves

- `verify:m047` exists as the milestone-level package script and composes `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()` as the only top-level evidence sources.
- The integrated report preserves nested S02, M045, and M046 JSON objects and exposes stable top-level check IDs plus five milestone scenario ids: `linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, and `coarse-fallback`.
- Each milestone scenario surfaces coherent review/runtime, retrieval, Slack/profile, identity, and contributor-model evidence or explicit not-applicable status where the surface does not apply, with `koprajs` anchoring calibrated-retained and `fkoemep` anchoring stale-degraded.
- Malformed or failing nested reports, missing scenario evidence, mapping drift, invalid CLI args, or package-script mismatches fail the proof surface loudly, while the truthful M046 `replace` verdict remains reported as machine-readable data instead of a harness failure.
- `scripts/verify-m047.test.ts`, `bun run verify:m047 -- --json`, the prerequisite proof scripts, and `bun run tsc --noEmit` all pass together.

## Threat Surface

- **Abuse**: A false-green `verify:m047` could hide milestone drift if it re-derives expectations from the same helpers under test, ignores failing nested reports, or fabricates downstream Slack/profile evidence for the coarse-fallback scenario instead of marking that surface not applicable.
- **Data exposure**: The integrated JSON and human reports may include contributor usernames, scenario ids, check ids, and M046 change-contract rationale, but they must not introduce new exposure of Slack IDs, tokens, contributor profile IDs, or raw expertise/private store fields beyond the already-redacted nested proof surfaces.
- **Input trust**: `process.argv`, the nested report objects returned by `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()`, and the `package.json` script contract are all untrusted inputs until the top-level harness validates their shapes and fails closed on malformed or contradictory evidence.

## Requirement Impact

- **Requirements touched**: `R048` directly (slice owner); `R046` supporting because the milestone-close harness must preserve the M045 contributor-experience contract truthfully.
- **Re-verify**: `bun test ./scripts/verify-m047.test.ts`, `bun run verify:m047 -- --json`, `bun run verify:m047:s02 -- --json`, `bun run verify:m045:s03 -- --json`, `bun run verify:m046 -- --json`, and `bun run tsc --noEmit` must all agree on the same integrated scenario matrix.
- **Decisions revisited**: `D087` (M047 proof composition strategy), `D091` (stable scenario-level diagnostics for M047/S01), and `D094` (compose downstream proof from embedded upstream evidence instead of re-implementing resolution logic).

## Proof Level

- This slice proves: final-assembly proof on the real milestone-close CLI entrypoint (`bun run verify:m047`) by composing deterministic nested proof surfaces; real runtime required: no; human/UAT required: no.

## Integration Closure

- Upstream surfaces consumed: `scripts/verify-m047-s02.ts`, `scripts/verify-m045-s03.ts`, `scripts/verify-m046.ts`, and the package-script contract in `package.json`.
- New wiring introduced in this slice: `scripts/verify-m047.ts` becomes the single milestone-close entrypoint that maps five operator-facing scenarios onto nested S02/M045/M046 evidence without re-running deeper business logic.
- What remains before the milestone is truly usable end-to-end: nothing inside M047 once the integrated verifier, prerequisite proof scripts, and TypeScript check all pass.

## Verification

- `bun test ./scripts/verify-m047.test.ts`
- `bun run verify:m047 -- --json`
- `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`
- `bun run tsc --noEmit`

## Tasks

- [x] **T01: Compose the milestone-close `verify:m047` proof harness** `est:2h`
  - Why: S03 owns R048 and needs the operator-facing `verify:m047` entrypoint that composes the already-shipped S02, M045, and M046 proof surfaces without re-deriving lower-level contributor logic.
  - Do: Add `scripts/verify-m047.ts` to call `evaluateM047S02`, `evaluateM045S03`, and `evaluateM046`, validate nested report shapes and failure states, map the five milestone scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`), preserve full nested report JSON, and wire `verify:m047` into `package.json` with human and `--json` output.
  - Done when: `bun run verify:m047 -- --json` emits stable top-level check IDs, five milestone scenarios, explicit not-applicable handling for coarse-fallback Slack/profile continuity, and nested S02/M045/M046 evidence without failing just because M046's verdict is `replace`.
  - Files: `scripts/verify-m047.ts`, `package.json`
  - Verify: `bun run verify:m047 -- --json`

- [ ] **T02: Lock the integrated verifier with drift-focused regression tests** `est:90m`
  - Why: The milestone-close verifier is only useful if scenario mapping, nested evidence preservation, CLI parsing, and script wiring fail loudly instead of going false-green.
  - Do: Add `scripts/verify-m047.test.ts` with real nested happy-path coverage plus injected malformed and failed nested reports, missing scenario evidence, calibrated-retained and stale-degraded drift, coarse-fallback not-applicable expectations, human/JSON output alignment, invalid-arg handling, and `package.json` script wiring assertions; adjust `scripts/verify-m047.ts` only as needed to keep those tests green.
  - Done when: the dedicated verifier test plus the prerequisite S02/M045/M046 proof bundle and `bun run tsc --noEmit` all pass, leaving `verify:m047` as the single milestone-close inspection surface.
  - Files: `scripts/verify-m047.test.ts`, `scripts/verify-m047.ts`, `package.json`
  - Verify: `bun test ./scripts/verify-m047.test.ts && bun run verify:m047 -- --json && bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json && bun run tsc --noEmit`

## Files Likely Touched

- scripts/verify-m047.ts
- package.json
- scripts/verify-m047.test.ts
