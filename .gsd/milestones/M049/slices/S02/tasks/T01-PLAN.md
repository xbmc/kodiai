---
estimated_steps: 5
estimated_files: 2
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Add exact review-output artifact proof helpers

**Slice:** S02 — Live proof and auditability verification
**Milestone:** M049

## Description

Add a dedicated exact-match GitHub artifact collector and visible-body validator for one explicit clean-approval `reviewOutputKey`. Keep this separate from `recent-review-sample.ts`, which intentionally keeps only the newest marker-backed artifact per PR and cannot prove "exactly one visible outcome." The helper should preserve all matching issue comments, review comments, and reviews for one PR, plus the full body, URL, timestamps, and review state needed for operator-facing proof.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| GitHub PR review/comment list endpoints | Propagate a named collection failure to the caller instead of returning partial counts or silently claiming uniqueness. | Keep the helper side-effect free and let the verifier map the failure to a non-success GitHub-access status. | Ignore non-matching bodies/keys, but surface invalid matching artifacts (missing URL/timestamp/review state) as validation failures so proof cannot go green on incomplete data. |
| `extractReviewOutputKey(...)` / `parseReviewOutputKey(...)` identity helpers | Reject unparseable keys before any artifact is treated as a match. | N/A — pure local parsing. | Treat repo/PR/action mismatches as non-matches and keep exact-count proof scoped to the encoded identity. |

## Load Profile

- **Shared resources**: one PR-scoped set of GitHub reviews/comments across three list endpoints.
- **Per-operation cost**: up to three paged list calls for one PR plus body validation on matching artifacts only.
- **10x breakpoint**: very chatty PRs increase page count; keep collection bounded to the encoded PR and avoid repository-wide sampling or latest-only heuristics that hide duplicates.

## Negative Tests

- **Malformed inputs**: unparseable `reviewOutputKey`, marker on the wrong PR/repo/action, missing review URL/timestamp, and missing review body/state.
- **Error paths**: GitHub list call throws or times out, helper receives no matches, or multiple surfaces share the same key.
- **Boundary conditions**: zero matches, exactly one `APPROVED` review, one match on the wrong surface, one review with non-`APPROVED` state, and bodies with `0`, `1`, `3`, and `4` evidence bullets.

## Steps

1. Add focused tests in `src/review-audit/review-output-artifacts.test.ts` for exact marker collection across issue comments, review comments, and reviews; wrong-repo/wrong-PR/wrong-lane mismatches; duplicate multi-surface matches; and visible-body drift cases.
2. Implement `src/review-audit/review-output-artifacts.ts` so it parses the requested `reviewOutputKey`, queries only the encoded PR, preserves every matching artifact, and returns exact per-surface counts instead of latest-only sampling.
3. Reuse `extractReviewOutputKey(...)` / `parseReviewOutputKey(...)` from `src/handlers/review-idempotency.ts` for identity checks so GitHub artifact proof and Azure audit correlation stay on the same key/delivery contract.
4. Expose a pure body validator that accepts only the S01 shared APPROVE grammar: `Decision: APPROVE`, `Issues: none`, `Evidence:`, 1–3 bullets, the same marker, and no `<details>` wrapper or legacy collapsed-review text.
5. Re-run the focused helper tests and confirm the helper fails deterministically when more than one visible artifact exists or when the sole artifact is not an `APPROVED` review.

## Must-Haves

- [ ] The helper returns exact counts for reviews, issue comments, and review comments matching one `reviewOutputKey` on the encoded PR.
- [ ] Matching artifacts preserve `source`, `sourceUrl`, `updatedAt`, full `body`, and `reviewState` so the live verifier can prove the sole visible artifact is an `APPROVED` review.
- [ ] The body validator accepts the shipped visible APPROVE grammar and rejects wrapper drift, missing headings, missing marker, and 0-or-4+ evidence-bullet shapes.

## Verification

- `bun test ./src/review-audit/review-output-artifacts.test.ts`
- Confirm the failing cases name duplicate outputs, wrong surface/state, or body drift instead of collapsing them into a generic missing-artifact result.

## Observability Impact

- Signals added/changed: helper output preserves per-surface counts, artifact URLs, timestamps, and review state so later live proof can pinpoint where publication happened.
- How a future agent inspects this: run `bun test ./src/review-audit/review-output-artifacts.test.ts` and inspect explicit failures for duplicate matches, wrong surface, wrong review state, or body drift.
- Failure state exposed: ambiguous latest-only sampling is replaced by exact duplicate/mismatch/body-contract failures keyed to the requested `reviewOutputKey`.

## Inputs

- `src/handlers/review-idempotency.ts` — existing marker extraction and `reviewOutputKey` parsing helpers that define the live identity contract.
- `src/handlers/review-idempotency.test.ts` — current approval-body/marker regression tests that define the shipped visible APPROVE grammar.
- `src/review-audit/recent-review-sample.ts` — latest-only sampling helper that this task must not overload with exact-count semantics.
- `src/review-audit/recent-review-sample.test.ts` — current sample-selection coverage showing why a separate exact-match helper is safer.

## Expected Output

- `src/review-audit/review-output-artifacts.ts` — PR-scoped exact-match collector plus visible APPROVE body validator for one `reviewOutputKey`.
- `src/review-audit/review-output-artifacts.test.ts` — focused regression tests for surface counts, preserved metadata, review-state checks, and body-contract drift.
