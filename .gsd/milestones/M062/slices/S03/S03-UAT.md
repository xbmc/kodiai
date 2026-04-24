# S03: S03 — UAT

**Milestone:** M062
**Written:** 2026-04-24T05:04:39.569Z

# UAT: M062 / S03 — Large-PR baseline proof harness

## Preconditions

- Working tree contains the S03 verifier and tests.
- Bun dependencies are installed.
- Run commands from the repository root.

## Test Case 1 — Full verifier regression gate passes
1. Run `bun test ./scripts/verify-m062-s03.test.ts ./scripts/verify-m062-s01.test.ts`.
   - Expected: Exit code 0.
   - Expected: `verify-m062-s03` and `verify-m062-s01` suites both pass.
   - Expected: Coverage includes default matrix evaluation, semantic parity checks, JSON output, single-scenario targeting, unknown scenario rejection, and package script wiring.

## Test Case 2 — Visible-surface truthfulness verifier passes for the full matrix
1. Run `bun run verify:m062:s03 -- --json`.
   - Expected: Exit code 0.
   - Expected: Top-level JSON includes `command: "verify:m062:s03"`, `scenario_count: 4`, `success: true`, and `status_code: "m062_s03_ok"`.
2. Inspect the three bounded scenarios (`timeout-checkpoint`, `max-turns-checkpoint`, `large-pr-bounded`).
   - Expected: Each reports `statusCode: "bounded-parity-ok"`.
   - Expected: Each reports pass parity checks for bounded reason, covered scope, remaining scope, and continuation state.
3. Inspect `zero-evidence-failure`.
   - Expected: It reports `statusCode: "dead-end-rejected"`.
   - Expected: `boundedCommentEligible` is `false` and `boundedCommentRendered` is `false`.
   - Expected: `commentError` explains that a publishable bounded-first-pass payload is required.

## Test Case 3 — Classification seam remains aligned with S01
1. Run `bun run verify:m062:s01 -- --json`.
   - Expected: Exit code 0.
   - Expected: Top-level JSON includes `status_code: "m062_s01_ok"` and `scenario_count: 4`.
2. Compare scenario identities with the S03 output.
   - Expected: The same four scenario IDs appear in both verifier surfaces.
   - Expected: Bounded scenarios stay publication-eligible in S01 and render as bounded parity successes in S03.
   - Expected: `zero-evidence-failure` stays publication-ineligible in S01 and dead-end-rejected in S03.

## Test Case 4 — Production rendering helpers stay compatible with the verifier contract
1. Run `bun test ./src/lib/review-utils.test.ts ./src/lib/partial-review-formatter.test.ts ./src/handlers/review.test.ts`.
   - Expected: Exit code 0.
   - Expected: Formatter tests confirm Review Details and bounded public comments use the same bounded-review wording contract.
   - Expected: Handler tests confirm timeout, retry-merged, and max-turns fallback publication paths still honor the bounded first-pass contract.

## Test Case 5 — TypeScript safety gate remains clean
1. Run `bun run tsc --noEmit`.
   - Expected: Exit code 0.
   - Expected: No type errors introduced by the verifier, tests, or package script wiring.

## Edge Case Checks

### Edge Case A — Single-scenario targeting stays deterministic
1. Run `bun run verify:m062:s03 -- --scenario large-pr-bounded --json`.
   - Expected: Exit code 0.
   - Expected: Output includes exactly one scenario with `scenarioId: "large-pr-bounded"` and `statusCode: "bounded-parity-ok"`.
   - Expected: Parity checks still show covered scope, remaining scope, and continuation state alignment.

### Edge Case B — Unknown scenario targeting fails loudly
1. Run `bun scripts/verify-m062-s03.ts --scenario does-not-exist --json`.
   - Expected: Non-zero exit.
   - Expected: Output reports a named invalid-argument failure instead of silently falling back to the full matrix.

### Edge Case C — Zero-evidence failure cannot leak bounded-success wording
1. Review the `zero-evidence-failure` JSON block from Test Case 2.
   - Expected: Review Details renders the failure state, but no bounded public comment is rendered.
   - Expected: The verifier records this as an expected negative path, not as a parity pass for bounded output.
