# S01: S01 — UAT

**Milestone:** M062
**Written:** 2026-04-24T04:19:44.228Z

# UAT — M062/S01 bounded first-pass contract

## Preconditions
- Repository is on the S01 slice result.
- Bun dependencies are installed.
- No live GitHub, Slack, or Azure access is required; all checks are deterministic.

## Test Case 1 — Timeout with checkpoint evidence publishes bounded first-pass truth
1. Run `bun run verify:m062:s01 -- --json`.
2. Find scenario `timeout-checkpoint`.
3. Confirm expected outcome:
   - `state` is `bounded-first-pass`
   - `boundedReason` is `timeout`
   - `evidenceSource` is `checkpoint`
   - `publicationEligible` is `true`
   - `coveredFiles` is `2`, `remainingFiles` is `3`, `totalFiles` is `5`
4. Expected result: the scenario is classified as publishable bounded first-pass output rather than dead-end failure.

## Test Case 2 — `max_turns` with structured evidence no longer dies as a hard failure
1. In the same verifier output, find scenario `max-turns-checkpoint`.
2. Confirm expected outcome:
   - `state` is `bounded-first-pass`
   - `boundedReason` is `max-turns`
   - `evidenceSource` is `checkpoint`
   - `publicationEligible` is `true`
   - `hasPublishedOutput` is `true`
3. Expected result: structured evidence keeps `max_turns` on the truthful bounded first-pass path instead of the old dead-end path.

## Test Case 3 — Large-PR boundedness without checkpoint still publishes truthful constrained output
1. In the same verifier output, find scenario `large-pr-bounded`.
2. Confirm expected outcome:
   - `state` is `bounded-first-pass`
   - `boundedReason` is `large-pr`
   - `evidenceSource` is `boundedness`
   - `publicationEligible` is `true`
   - `coveredFiles` and `remainingFiles` are non-null and consistent with `totalFiles`
3. Expected result: boundedness-only evidence is sufficient for truthful first-pass publication.

## Test Case 4 — Zero-evidence constrained run remains an explicit hard failure
1. In the same verifier output, find scenario `zero-evidence-failure`.
2. Confirm expected outcome:
   - `state` is `zero-evidence-failure`
   - `statusCode` is `dead-end-failure`
   - `evidenceSource` is `none`
   - `publicationEligible` is `false`
   - coverage fields are `null`
3. Expected result: the system still distinguishes true no-evidence failure from bounded first-pass publication.

## Test Case 5 — Formatter and Review Details share the same normalized contract
1. Run `bun test ./src/lib/partial-review-formatter.test.ts ./src/lib/review-utils.test.ts ./src/handlers/review.test.ts`.
2. Confirm the targeted bounded-first-pass tests pass, including:
   - formatter coverage for bounded timeout and `max_turns`
   - Review Details coverage for bounded-first-pass diagnostics and zero-evidence hard failure
   - handler coverage for timeout publication and `max_turns` first-pass publication
3. Expected result: one contract drives both the visible summary surface and Review Details without wording/coverage drift.

## Edge Cases
- Malformed structured scope must omit unsupported counts instead of synthesizing impossible values.
- Bounded reason and evidence source must stay machine-checkable even when public prose changes later.
- A constrained run with no checkpoint and no boundedness evidence must remain ineligible for bounded publication.

