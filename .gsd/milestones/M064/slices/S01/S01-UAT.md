# S01: S01 — UAT

**Milestone:** M064
**Written:** 2026-04-24T07:21:46.452Z

# S01 UAT — Canonical continuation-family authority

## Preconditions
- The code under test includes the `continuation_family_state` migration, store contract, review-handler canonical write paths, and `verify:m064:s01` verifier script.
- Bun is installed.
- For the deterministic verifier cases, no live GitHub or telemetry services are required.
- Optional: set `TEST_DATABASE_URL` if you want to exercise the PostgreSQL-backed store tests instead of allowing them to skip.

## Test Case 1 — Canonical verifier reports merged continuation authority
1. Run `bun run verify:m064:s01 -- --json`.
2. Inspect the `merge-authority` scenario in the JSON output.
3. Confirm `success` is `true` and `statusCode` is `canonical-merged`.
4. Confirm the scenario reports a non-empty `familyKey`, the expected `baseReviewOutputKey`, `authoritativeAttemptId`, `authoritativeAttemptOrdinal`, `authoritativeOutcome: "merged"`, `finalStopReason: "merged-continuation-results"`, and `projectionStatus: "canonical"`.

**Expected outcome:** The merged scenario answers directly from canonical continuation-family state and names the winning attempt without requiring checkpoint or telemetry correlation.

## Test Case 2 — Canonical verifier reports quiet settlement without public rewrite pressure
1. Run `bun run verify:m064:s01 -- --json`.
2. Inspect the `quiet-settlement` scenario.
3. Confirm `success` is `true` and `statusCode` is `canonical-quiet-settled`.
4. Confirm `authoritativeOutcome` is `quiet-settled` and `finalStopReason` is `settled-without-update`.

**Expected outcome:** Canonical state shows that continuation settled with no meaningful delta while still preserving the authoritative attempt identity and canonical projection status.

## Test Case 3 — Canonical verifier reports blocked/no-follow-up terminal truth
1. Run `bun run verify:m064:s01 -- --json`.
2. Inspect the `blocked-no-follow-up` scenario.
3. Confirm `success` is `true` and `statusCode` is `canonical-blocked`.
4. Confirm `authoritativeOutcome` is `blocked`, `finalStopReason` is `no-follow-up`, and the authoritative attempt remains the original attempt.

**Expected outcome:** Operators can answer why continuation stopped directly from canonical durable state when no retry is possible.

## Test Case 4 — Superseded stale attempt cannot reclaim authority
1. Run `bun run verify:m064:s01 -- --json`.
2. Inspect the `superseded-stale-attempt` scenario.
3. Confirm `success` is `true` and `statusCode` is `canonical-superseded`.
4. Confirm the output names the newer winning attempt as `authoritativeAttemptId`, reports `authoritativeOutcome: "superseded"`, `finalStopReason: "superseded-by-newer-attempt"`, `projectionStatus: "degraded"`, and includes `supersededByAttemptId` for the winning attempt.
5. Confirm the `supersession-shield` check status is `pass`.

**Expected outcome:** A stale or late-finishing continuation attempt cannot overwrite canonical family truth once a newer attempt has claimed authority.

## Test Case 5 — Handler test suite proves canonical writes on runtime transitions
1. Run `bun test src/handlers/review.test.ts`.
2. Confirm the suite passes.
3. Review the output for the canonical continuation-family state coverage names:
   - `records blocked canonical state when timeout has no remaining continuation scope`
   - `records continuation-pending canonical state when timeout schedules a retry`
   - `records merged canonical state when retry results merge into the canonical comment`
   - `records quiet-settled canonical state when retry settles without a meaningful delta`

**Expected outcome:** Runtime coordinator transitions are persisted to the canonical authority surface during review handling.

## Edge Case — Store-level durability test gate without database config
1. Run `bun test src/knowledge/store.test.ts` in an environment without `TEST_DATABASE_URL`.
2. Observe that the command exits 0 and skips the PostgreSQL-backed store cases.
3. Re-run the same command in an environment with `TEST_DATABASE_URL` configured.

**Expected outcome:** Without a test database, the suite skips rather than failing; with a configured test database, the canonical store insert/read, restart-shaped durability, stale-attempt suppression, and newer-attempt replacement cases should execute against PostgreSQL. This confirms the remaining infra-gated proof surface for the slice.
