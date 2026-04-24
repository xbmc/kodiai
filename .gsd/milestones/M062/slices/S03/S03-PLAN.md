# S03: Large-PR baseline proof harness

**Goal:** Add a deterministic milestone-level verifier that composes the S01 normalized first-pass contract with the S02 visible rendering helpers so operators can prove large-PR bounded-review output stays truthful before continuation redesign begins.
**Demo:** After this: operators can run a deterministic verifier that proves the bounded large-PR baseline behaves truthfully before continuation redesign starts.

## Must-Haves

- `scripts/verify-m062-s03.ts` evaluates the S01 scenario matrix through production rendering helpers and reports machine-readable pass/fail results for visible-surface truthfulness.
- `scripts/verify-m062-s03.test.ts` proves bounded scenarios keep public comment and Review Details aligned on bounded reason, covered scope, remaining scope, and continuation state, while zero-evidence failure cannot publish bounded-success wording.
- `package.json` exposes `verify:m062:s03`, and the slice verification commands pass: `bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts`, `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts`, `bun run verify:m062:s01 -- --json`, `bun run verify:m062:s03 -- --json`, and `bun run tsc --noEmit`.

## Proof Level

- This slice proves: This slice proves: contract + integration. Real runtime required: no. Human/UAT required: no.

## Integration Closure

The slice consumes S01's deterministic scenario matrix and S02's production formatter helpers, adds one milestone verifier entrypoint in `package.json`, and leaves the milestone with a deterministic local proof surface operators can run before M063 continuation work. Nothing else should remain for M062 once the verifier and regression suite pass.

## Verification

- Adds a second deterministic verifier surface (`verify:m062:s03 -- --json`) that exposes scenario-level wording parity, visibility eligibility, and failure reasons across large-PR bounded and zero-evidence cases, making future regressions diagnosable without replaying live GitHub runs.

## Tasks

- [x] **T01: Compose the milestone verifier from S01 scenarios and S02 rendering helpers** `est:75m`
  Build the new deterministic verifier around production seams rather than duplicated fixture prose. Reuse `getDefaultScenarioMatrix()` and `evaluateScenario()` from `scripts/verify-m062-s01.ts`, feed bounded-first-pass payloads through `formatPartialReviewComment()` and `formatReviewDetailsSummary()`, and emit a compact report that classifies whether the two visible surfaces stay truthful and mutually consistent for each scenario. Document in the code that bounded scenarios must prove reason/coverage/continuation parity while zero-evidence scenarios must remain ineligible for bounded public comment.

Steps:
1. Create `scripts/verify-m062-s03.ts` with typed scenario/report shapes and CLI parsing that mirrors the established verifier style in `scripts/verify-m062-s01.ts`.
2. Reuse the S01 scenario matrix and normalized payload output instead of reconstructing first-pass payloads by hand; for bounded scenarios, render both visible surfaces with production helpers and extract semantic checks for bounded reason, covered scope, remaining scope or truthful uncertainty, and continuation state.
3. For the zero-evidence scenario, assert the verifier records a dead-end failure classification and captures that `formatPartialReviewComment()` rejects non-bounded payloads rather than letting the scenario masquerade as bounded success.
4. Render human-readable and `--json` output that includes stable per-scenario status, key parity checks, and issues so future agents can localize regressions quickly.
  - Files: `scripts/verify-m062-s03.ts`, `scripts/verify-m062-s01.ts`, `src/lib/review-utils.ts`, `src/lib/partial-review-formatter.ts`
  - Verify: bun test ./scripts/verify-m062-s03.test.ts --filter "verify-m062-s03"

- [x] **T02: Lock the verifier contract with regression tests and script wiring** `est:60m`
  Add targeted Bun tests and package wiring so the new verifier becomes a stable regression gate instead of an ad hoc script. Keep assertions semantic: verify scenario classifications, parity signals, zero-evidence rejection, single-scenario targeting, JSON shape, and package script registration without snapshotting whole comment bodies.

Steps:
1. Create `scripts/verify-m062-s03.test.ts` following the existing verifier-test style in `scripts/verify-m062-s01.test.ts`.
2. Add tests for the default matrix, `--scenario` targeting, human-readable rendering, JSON output shape, bounded-surface parity checks, and the zero-evidence negative path.
3. Wire `verify:m062:s03` into `package.json` so operators can run the verifier with the same pattern as other milestone scripts.
4. Keep assertions tied to production semantics (reason labels, coverage counts, continuation wording, bounded-comment eligibility) rather than brittle full-body snapshots.
  - Files: `scripts/verify-m062-s03.test.ts`, `scripts/verify-m062-s03.ts`, `scripts/verify-m062-s01.test.ts`, `package.json`
  - Verify: bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts

- [ ] **T03: Run the milestone proof sweep and polish failure diagnostics** `est:45m`
  Close the slice by running the full deterministic proof stack and tightening report wording if any failure output is ambiguous. This task exists so S03 ends with a trustworthy operator-facing gate, not just new code that compiles locally.

Steps:
1. Run the slice verification commands in order, including both verifier scripts, formatter/handler regressions, and `bun run tsc --noEmit`.
2. If a verifier failure message is ambiguous, make the smallest focused adjustment in `scripts/verify-m062-s03.ts` or `scripts/verify-m062-s03.test.ts` so the failing scenario, broken parity check, and expected contract are explicit.
3. Re-run the affected commands until the full proof sweep passes cleanly.
4. Confirm the final `verify:m062:s03 -- --json` output remains compact, deterministic, and usable as an operator evidence surface for M062 closeout.
  - Files: `scripts/verify-m062-s03.ts`, `scripts/verify-m062-s03.test.ts`, `package.json`, `src/lib/review-utils.test.ts`, `src/lib/partial-review-formatter.test.ts`, `src/handlers/review.test.ts`
  - Verify: bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts && bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts && bun run verify:m062:s01 -- --json && bun run verify:m062:s03 -- --json && bun run tsc --noEmit

## Files Likely Touched

- scripts/verify-m062-s03.ts
- scripts/verify-m062-s01.ts
- src/lib/review-utils.ts
- src/lib/partial-review-formatter.ts
- scripts/verify-m062-s03.test.ts
- scripts/verify-m062-s01.test.ts
- package.json
- src/lib/review-utils.test.ts
- src/lib/partial-review-formatter.test.ts
- src/handlers/review.test.ts
