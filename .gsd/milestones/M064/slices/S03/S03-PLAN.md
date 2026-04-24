# S03: Canonical-state-first operator evidence and projection-status proof

**Goal:** Add a canonical-state-first operator evidence surface that resolves continuation-family truth from operator-available review output identity, renders explicit projection status, and proves the report contract without rebuilding truth from checkpoints, telemetry, or logs.
**Demo:** After this slice, an operator can run one deterministic report/verifier and see final authoritative outcome, stop reason, winning attempt, and any degraded projection statuses for a continuation family without log correlation.

## Must-Haves

- Operators can resolve a continuation-family record from a `reviewOutputKey`-shaped identifier without manually supplying raw canonical DB keys.
- The shared report object and human output answer authoritative outcome, final stop reason, authoritative attempt identity, supersession metadata, and `projectionStatus` directly from canonical state.
- Projection degradation is rendered explicitly as status layered on canonical truth, not inferred by correlating telemetry/checkpoint rows.
- Deterministic tests and verifier output cover canonical, degraded, pending, and superseded report states while keeping verifier expectations independent from the report helpers they validate.
- Package wiring exposes a top-level `verify:m064:s03` command and regression verification preserves the established S01/S02 contracts.

## Proof Level

- This slice proves: - This slice proves: operational
- Real runtime required: no
- Human/UAT required: no

## Integration Closure

- Upstream surfaces consumed: `src/handlers/review-idempotency.ts` for operator identity parsing, `src/jobs/review-work-coordinator.ts` family-key contract, `src/knowledge/store.ts` canonical read seam, and the S01/S02 verifier/report patterns in `scripts/verify-m064-s01.ts`, `scripts/verify-m064-s02.ts`, and `scripts/usage-report.ts`.
- New wiring introduced in this slice: a shared canonical operator-evidence resolver/report module plus a `verify:m064:s03` CLI entrypoint that uses it for deterministic and operator-facing output.
- What remains before the milestone is truly usable end-to-end: nothing beyond running the new verifier/report command in an environment with canonical rows available.

## Verification

- Runtime signals: canonical continuation-family fields remain the only truth source; operator output must surface `projectionStatus`, `authoritativeAttemptId`, `finalStopReason`, and `supersededByAttemptId` verbatim from the canonical row.
- Inspection surfaces: `bun run verify:m064:s03 -- --json` and human-readable report output become the supported operator inspection seam for continuation lifecycle evidence.
- Failure visibility: lookup failures, malformed operator input, missing canonical rows, and degraded/pending projection states must be explicit in report status/detail without requiring log correlation.
- Redaction constraints: the report may echo review identity and canonical lifecycle metadata but must not introduce telemetry/checkpoint payload dumping or secret-bearing diagnostics.

## Tasks

- [x] **T01: Add canonical operator-evidence resolver and report builder** `est:1.5h`
  Build the shared read-side seam for S03 so downstream scripts can answer from canonical continuation-family state without operators reconstructing raw DB keys by hand. Reuse the existing review-output-key and family-key contracts instead of introducing a rival identity scheme or search API. Add focused unit tests for lookup resolution, missing-row behavior, malformed reviewOutputKey input, and canonical-state-to-report mapping for canonical, degraded, pending, and superseded lifecycle states. Keep the report builder separate from CLI concerns so later milestone work can reuse it directly.
  - Files: `src/knowledge/types.ts`, `src/knowledge/store.ts`, `src/handlers/review-idempotency.ts`, `src/jobs/review-work-coordinator.ts`, `src/knowledge/continuation-operator-evidence.ts`, `src/knowledge/continuation-operator-evidence.test.ts`
  - Verify: bun test src/knowledge/continuation-operator-evidence.test.ts

- [x] **T02: Ship the S03 verifier/report command and lock its operator contract** `est:2h`
  Add the top-level `verify:m064:s03` script that uses the shared resolver/report builder to expose both human and JSON output. Follow the existing verifier/report style: deterministic fixture-driven default execution for CI, explicit invalid-arg handling, and optional operator-lookup mode driven by review output key input. Ensure the rendered report leads with authoritative outcome, final stop reason, authoritative attempt identity, projection status, and supersession metadata. Add script tests that keep expectations independent from the helper under test, prove degraded and pending projection statuses render explicitly, and verify package.json wiring for `verify:m064:s03`.
  - Files: `scripts/verify-m064-s03.ts`, `scripts/verify-m064-s03.test.ts`, `package.json`, `src/knowledge/continuation-operator-evidence.ts`, `scripts/usage-report.ts`
  - Verify: bun test scripts/verify-m064-s03.test.ts

- [ ] **T03: Regress prior canonical contracts and prove slice-close verification** `est:45m`
  Finish the slice by running the new S03 proof surface alongside the existing M064 verifiers so the operator report remains subordinate to canonical truth rather than redefining it. If minor gaps appear during verification, tighten report wording or scenario fixtures instead of weakening expectations. Update any affected tests so the slice closes with one executable verification chain covering the new report plus prior S01/S02 canonical-state guarantees.
  - Files: `scripts/verify-m064-s01.test.ts`, `scripts/verify-m064-s02.test.ts`, `scripts/verify-m064-s03.ts`, `scripts/verify-m064-s03.test.ts`, `package.json`
  - Verify: bun test src/knowledge/continuation-operator-evidence.test.ts && bun test scripts/verify-m064-s03.test.ts && bun run verify:m064:s03 -- --json && bun test scripts/verify-m064-s01.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s01 -- --json && bun run verify:m064:s02 -- --json

## Files Likely Touched

- src/knowledge/types.ts
- src/knowledge/store.ts
- src/handlers/review-idempotency.ts
- src/jobs/review-work-coordinator.ts
- src/knowledge/continuation-operator-evidence.ts
- src/knowledge/continuation-operator-evidence.test.ts
- scripts/verify-m064-s03.ts
- scripts/verify-m064-s03.test.ts
- package.json
- scripts/usage-report.ts
- scripts/verify-m064-s01.test.ts
- scripts/verify-m064-s02.test.ts
