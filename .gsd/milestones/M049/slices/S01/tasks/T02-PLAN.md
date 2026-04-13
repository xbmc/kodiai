---
estimated_steps: 4
estimated_files: 4
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T02: Adopt the shared approval body in explicit and automatic review publishers

**Slice:** S01 — Shared clean-approval review body contract
**Milestone:** M049

## Description

Move the two real approval publishers onto the shared formatter so the milestone demo becomes true on both GitHub-visible lanes. This task should reuse facts already available in each handler (for example prompt file counts, repo-inspection confirmation, changed-file counts, and dep-bump merge confidence) rather than adding new API calls just to populate evidence bullets.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/handlers/mention.ts` explicit-review publish bridge | Keep the existing publish gate/idempotency flow; a body-shape regression should fail handler tests rather than silently skipping visible output. | Use the existing review execution / publish timeout behavior; do not add new network work for evidence lines. | Derive evidence from facts already computed on the lane instead of trusting free-form result prose. |
| `src/handlers/review.ts` automatic clean-review publisher | Preserve the current clean-review approval path and dep-bump confidence behavior while swapping out the marker-only body. | Reuse the existing publish path and avoid extra API calls just to populate evidence. | Keep evidence deterministic from already-available review facts so malformed or missing lane facts degrade predictably in tests. |
| Shared idempotency gate | Continue skipping duplicate publish when the marker already exists. | Existing paged GitHub scans remain the bounded timeout surface. | Missing marker/body-shape assertions should fail tests before they reach runtime. |

## Load Profile

- **Shared resources**: GitHub review publish path, existing idempotency scans, and already-computed prompt/review metadata.
- **Per-operation cost**: reuse one shared formatter plus already-available facts such as prompt file count or dep-bump confidence; do not add new API calls.
- **10x breakpoint**: large PRs or repeated reruns stress the existing review execution/publish path before formatting cost matters, so evidence lines must be computed from existing handler state rather than fresh remote lookups.

## Negative Tests

- **Malformed inputs**: missing prompt file count on explicit review, missing dep-bump context, and clean results that still include finding-shaped text.
- **Error paths**: marker already present, publish gate rejects clean approval, or a handler falls back to the old marker-only body.
- **Boundary conditions**: explicit clean approval, automatic clean approval, and dep-bump clean approval all emit the shared contract while duplicate publication stays suppressed.

## Steps

1. Update `src/handlers/mention.test.ts` and `src/handlers/review.test.ts` first to assert the shared approval body shape on both publish lanes, including marker continuity and the lane-specific evidence facts each handler already knows.
2. Thread those deterministic lane facts into `buildApprovedReviewBody(...)` from `src/handlers/mention.ts` and `src/handlers/review.ts`, preserving the existing explicit-review publish gating and auto-review idempotency behavior.
3. Keep dep-bump approval confidence visible, but move it into the shared evidence-backed contract instead of leaving automatic review on a marker-only body with a trailing confidence line.
4. Re-run the handler suites and confirm duplicate publication is still skipped when the review-output marker already exists.

## Must-Haves

- [ ] Explicit `@kodiai review` clean approvals publish the shared visible body through the existing bridge path.
- [ ] Automatic clean-review approvals publish the same shared body instead of a marker-only approval.
- [ ] Dep-bump approval confidence remains visible and marker/idempotency behavior stays unchanged.

## Verification

- `bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts`
- Confirm both suites assert `Decision: APPROVE`, `Issues: none`, an `Evidence:` block, and the `review-output-key` marker on clean approvals.

## Observability Impact

- Signals added/changed: existing `review-output-idempotency`, `explicit-review-publish`, and `auto-approve` assertions/logging now diagnose the shared body shape instead of a marker-only approval body.
- How a future agent inspects this: run the focused handler suites and inspect published review-body assertions plus the existing publish-skip log expectations.
- Failure state exposed: regressions should present as missing evidence/marker assertions or a duplicate-publish skip mismatch, not as a silent marker-only fallback.

## Inputs

- `src/handlers/review-idempotency.ts` — shared approval-body builder from T01.
- `src/handlers/mention.ts` — explicit review publish bridge.
- `src/handlers/mention.test.ts` — explicit review publish assertions.
- `src/handlers/review.ts` — automatic clean-review publish lane.
- `src/handlers/review.test.ts` — automatic review approval assertions.
- `src/lib/review-utils.ts` — existing dep-bump approval-confidence helper.

## Expected Output

- `src/handlers/mention.ts` — explicit review approval bridge wired to the shared body and deterministic evidence lines.
- `src/handlers/mention.test.ts` — explicit review regressions for shared approval-body publication and idempotency continuity.
- `src/handlers/review.ts` — automatic clean-review publisher wired to the shared body, including dep-bump confidence evidence.
- `src/handlers/review.test.ts` — automatic review regressions for shared approval publication and duplicate-publish suppression.
