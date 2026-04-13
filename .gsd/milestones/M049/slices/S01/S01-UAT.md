# S01: Shared clean-approval review body contract — UAT

**Milestone:** M049
**Written:** 2026-04-13T14:56:18.391Z

# S01: Shared clean-approval review body contract — UAT

**Milestone:** M049

## Preconditions

- Work from the repo root with the S01 changes present.
- Bun dependencies are installed.
- No live GitHub access is required for this slice; all acceptance checks are local and target the shipped approval-body contract.

## Test Case 1 — Canonical clean-approval formatter emits the visible APPROVE grammar

1. Run `bun test ./src/handlers/review-idempotency.test.ts`.
   - **Expected:** The suite passes.
2. Inspect the named assertions covering `buildApprovedReviewBody(...)` in the output.
   - **Expected:** Tests confirm the body is visible markdown and contains `Decision: APPROVE`, `Issues: none`, an `Evidence:` block, 1–3 bullet lines, and the existing `review-output-key` marker.
3. Review the fallback/normalization assertions in the same suite.
   - **Expected:** Empty evidence inputs produce one default factual bullet, approval confidence is normalized into one evidence bullet, and the body is not wrapped in `<details>`.

## Test Case 2 — Explicit `@kodiai review` clean approvals publish the shared body once

1. Run `bun test ./src/handlers/mention.test.ts`.
   - **Expected:** The suite passes.
2. Locate the test `explicit PR review mention submits approval review when execution succeeds with inspection evidence`.
   - **Expected:** The created approval review body contains `Decision: APPROVE`, `Issues: none`, factual evidence lines, and a marker that `extractReviewOutputKey(...)` can read back.
3. Locate the test `explicit PR review mention logs idempotency skip when review output already exists`.
   - **Expected:** Duplicate publication is suppressed under the same `reviewOutputKey`; the handler keeps the same `review-output-idempotency` gate instead of posting a second visible outcome.
4. Locate the explicit publish-failure tests.
   - **Expected:** Failed approval publication still records the `reviewOutputKey` and distinct publish-attempt outcome values, preserving failure visibility instead of silently succeeding.

## Test Case 3 — Automatic clean review approvals use the same visible body and keep dep-bump evidence

1. Run `bun test ./src/handlers/review.test.ts`.
   - **Expected:** The suite passes.
2. Locate the test `replaying a clean PR review_requested does not create duplicate approvals`.
   - **Expected:** Automatic clean approvals publish one shared visible APPROVE review body and do not create duplicate approvals on replay.
3. Locate the test `auto-approve includes dep-bump merge confidence inside the shared approval body`.
   - **Expected:** Dep-bump merge confidence appears as structured evidence inside the same visible body instead of trailing outside it or disappearing.
4. Locate the test `does not auto-approve when review execution published output`.
   - **Expected:** The handler still avoids posting a clean approval when findings/output were already published.

## Test Case 4 — Approve-via-comment promotes only the shared APPROVE grammar

1. Run `bun test ./src/execution/mcp/comment-server.test.ts`.
   - **Expected:** The suite passes.
2. Locate the test `shared clean approval on PR submits APPROVE review with server-stamped marker`.
   - **Expected:** A valid visible APPROVE body is promoted to a GitHub `APPROVE` review and the server stamps the review-output marker itself.
3. Locate the malformed approval rejection tests for missing `Evidence:`, zero bullets, more than three bullets, wrapped approval, and extra prose.
   - **Expected:** Each malformed near-miss is rejected instead of being promoted to an approval review.
4. Locate the `NOT APPROVED still posts as regular comment even with prNumber` test.
   - **Expected:** The stricter APPROVE grammar does not widen the non-approval path; only clean approvals are promoted.

## Test Case 5 — Prompt guidance teaches the same narrow APPROVE grammar

1. Run `bun test ./src/execution/mention-prompt.test.ts`.
   - **Expected:** The suite passes.
2. Locate the test `includes conciseness guidance and shared visible APPROVE grammar instructions`.
   - **Expected:** The prompt teaches `Decision: APPROVE`, `Issues: none`, and an `Evidence:` block with 1–3 factual bullets.
3. Locate the test `keeps non-approval mention responses on the existing details wrapper contract`.
   - **Expected:** Only APPROVE responses moved to the visible grammar; ordinary mention replies and `Decision: NOT APPROVED` responses keep their existing wrapped contract.

## Edge Case 1 — Marker continuity survives the new visible body

1. Run the full slice command: `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts`.
   - **Expected:** The command exits 0.
2. Review the helper and handler assertions that use `extractReviewOutputKey(...)`.
   - **Expected:** The same marker is still present and recoverable from the new visible APPROVE body across helper, mention, review, and comment-server coverage.

## Edge Case 2 — Type safety remains clean after the cross-lane contract change

1. Run `bun run tsc --noEmit`.
   - **Expected:** The command exits 0 with no diagnostics.

## Edge Case 3 — Wrapped legacy approvals are no longer accepted

1. In `bun test ./src/execution/mcp/comment-server.test.ts`, inspect the test `rejects malformed shared approval body: legacy wrapped approval body`.
   - **Expected:** The legacy `<details>`-wrapped approval format is rejected for APPROVE promotion, proving the grammar boundary is now explicit and narrow.
