# S03: S03 — UAT

**Milestone:** M064
**Written:** 2026-04-24T08:11:44.750Z

# UAT — M064/S03 Canonical operator evidence and projection status

## Preconditions
- Repository checkout includes the M064/S03 changes.
- Bun dependencies are installed.
- No live database is required for fixture-mode verification.

## Test Case 1 — Deterministic JSON verifier exposes canonical and degraded lifecycle truth
1. Run `bun run verify:m064:s03 -- --json`.
2. Confirm the command exits 0.
3. Inspect the JSON payload.
4. Verify it contains `status_code: "m064_s03_ok"` and `record_count: 6`.
5. Verify the `canonical-authority` record reports:
   - `statusCode: "canonical"`
   - `authoritativeOutcome: "merged"`
   - `finalStopReason: "merged-continuation-results"`
   - `authoritativeAttemptId: "review-work-2"`
   - `projectionStatus: "canonical"`
6. Verify the `degraded-projection` record reports:
   - `statusCode: "degraded"`
   - `authoritativeOutcome: "blocked"`
   - `finalStopReason: "no-follow-up"`
   - `projectionStatus: "degraded"`

**Expected outcome:** The JSON output answers authoritative continuation truth directly from canonical-state-backed fixture records and shows degradation as explicit projection status rather than missing/implicit evidence.

## Test Case 2 — Pending and superseded states preserve winning attempt identity
1. Re-run `bun run verify:m064:s03 -- --json` if needed.
2. Verify the `pending-continuation` record reports:
   - `statusCode: "pending"`
   - `authoritativeOutcome: "continuation-pending"`
   - `finalStopReason: "awaiting-continuation"`
   - `authoritativeAttemptId: "review-work-2"`
   - `retryAttempt: 2`
   - `projectionStatus: "pending"`
3. Verify the `superseded-family` record reports:
   - `statusCode: "superseded"`
   - `authoritativeOutcome: "superseded"`
   - `finalStopReason: "superseded-by-newer-attempt"`
   - `authoritativeAttemptId: "review-work-3"`
   - `supersededByAttemptId: "review-work-3"`

**Expected outcome:** The report shows the authoritative attempt identity and supersession metadata directly, without correlating retries or stale-attempt logs.

## Test Case 3 — Human-readable operator output leads with canonical fields
1. Run `bun run verify:m064:s03`.
2. Confirm the command exits 0.
3. Verify the report header shows `# M064 S03 — Canonical Operator Evidence Report`.
4. Verify each record is listed with authoritative fields in this order: authoritative outcome, final stop reason, authoritative attempt id, projection status, supersededByAttemptId.
5. Confirm the degraded and pending records explicitly print `projectionStatus=degraded` and `projectionStatus=pending`.

**Expected outcome:** An operator can read one human-oriented report and immediately see final authoritative outcome, stop reason, winning attempt, and degraded projection state.

## Test Case 4 — Invalid and missing lookup states fail explicitly instead of silently
1. Run `bun run verify:m064:s03 -- --json`.
2. Verify the `missing-canonical-row` record reports `statusCode: "missing-canonical-row"` and null canonical lifecycle fields.
3. Verify the `invalid-review-output-key` record reports `statusCode: "invalid-review-output-key"` and null canonical lifecycle fields.

**Expected outcome:** Missing rows and malformed identifiers surface as explicit report states; operators are not forced to infer whether truth is absent, malformed, or merely degraded.

## Test Case 5 — Regression chain proves S03 remains subordinate to canonical truth
1. Run `bun test src/knowledge/continuation-operator-evidence.test.ts`.
2. Run `bun test scripts/verify-m064-s03.test.ts`.
3. Run `bun test scripts/verify-m064-s01.test.ts`.
4. Run `bun test scripts/verify-m064-s02.test.ts`.
5. Run `bun run verify:m064:s01 -- --json`.
6. Run `bun run verify:m064:s02 -- --json`.

**Expected outcome:** All commands exit 0. S01/S02 continue to prove canonical authority and runtime projection semantics, while S03 proves the operator evidence/report contract is only a projection of that same canonical truth.

## Edge Cases
- A malformed `reviewOutputKey` must produce an explicit `invalid-review-output-key` status, not a generic failure or empty response.
- A well-formed key with no canonical row must produce `missing-canonical-row`, preserving the derived identity while leaving lifecycle fields null.
- Projection degradation must never change authoritative lifecycle truth; only `projectionStatus` should degrade.
- Superseded families must continue to report the winning attempt and `supersededByAttemptId` even when older attempts finish later.
