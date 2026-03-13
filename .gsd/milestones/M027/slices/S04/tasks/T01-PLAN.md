---
estimated_steps: 3
estimated_files: 2
---

# T01: Lock the final integrated proof contract with failing tests

**Slice:** S04 — Final Integrated Production Repair Proof
**Milestone:** M027

## Description

Define the S04 acceptance contract before implementation so the final milestone proof cannot quietly drift into a shallow wrapper. The tests should lock the JSON and human report shapes, the milestone-level verdict rules, idempotent healthy-rerun semantics, and the truthful retriever-coverage boundary around `issue_comments`.

## Steps

1. Add `scripts/verify-m027-s04.test.ts` covering the final JSON envelope, human-readable summary, stable check IDs, and nested raw `s01`/`s02`/`s03` evidence preservation.
2. Add failure-path assertions for full-audit regression, retriever query-embedding unavailability, wiki `repair_resume_available`, non-wiki `repair_resume_available`, and honest `issue_comments:not_in_retriever` handling so S04 fails for the right reason.
3. Keep the tests intentionally red against the not-yet-implemented harness and verify the failures point at missing S04 behavior rather than vague placeholders.

## Must-Haves

- [ ] The test suite locks both idempotent-success and failure-path verdict semantics for the final proof harness.
- [ ] The tests require preserved subordinate evidence rather than allowing S04 to collapse S01/S02/S03 into one opaque boolean.

## Verification

- `bun test ./scripts/verify-m027-s04.test.ts`
- The failing output names missing S04 envelope/verdict behavior, not unrelated regressions.

## Observability Impact

- Signals added/changed: Locks stable final-proof check IDs, status codes, and nested evidence fields before implementation.
- How a future agent inspects this: Run `bun test ./scripts/verify-m027-s04.test.ts` to see exactly which milestone-proof contract edge regressed.
- Failure state exposed: Contract drift around full-audit gating, retriever truthfulness, or repair-state interpretation becomes immediately visible in one targeted test file.

## Inputs

- `scripts/verify-m027-s01.ts` — existing audit + retriever proof envelope and check-ID style to preserve.
- S04 research + S01/S02/S03 summaries — define that S04 must compose prior evidence, allow healthy no-op reruns, and keep `issue_comments` audited-only.

## Expected Output

- `scripts/verify-m027-s04.test.ts` — failing contract tests that define the final integrated proof boundary before production implementation.
