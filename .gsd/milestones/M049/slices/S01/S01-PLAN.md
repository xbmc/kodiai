# S01: Shared clean-approval review body contract

**Goal:** Ship one narrow clean-approval GitHub review-body contract across explicit mention, automatic review, and approve-via-comment paths so clean approvals visibly show decision, no-issues state, short factual evidence, and the existing review-output marker.
**Demo:** A clean approval on explicit `@kodiai review` and automatic review both show a short GitHub review body with `Decision: APPROVE`, `Issues: none`, factual evidence lines, and the existing review-output marker.

## Must-Haves

- `buildApprovedReviewBody(...)` becomes the canonical clean-approval formatter and emits `Decision: APPROVE`, `Issues: none`, an `Evidence:` block with 1–3 factual bullets, and the existing `review-output-key` marker.
- `src/handlers/mention.ts` and `src/handlers/review.ts` both publish clean approvals through the shared formatter without regressing idempotency, explicit-review publish gating, or dep-bump approval-confidence evidence.
- `src/execution/mcp/comment-server.ts` and `src/execution/mention-prompt.ts` accept and instruct the same narrow approved-review grammar so approve-via-comment still promotes valid clean approvals to GitHub `APPROVE` reviews while rejecting arbitrary prose.

## Threat Surface

- **Abuse**: A model-authored or comment-authored approval body could otherwise smuggle arbitrary prose, unsupported claims, or wrapper-only formatting into a trusted `APPROVE` review; the shared contract must keep approval publishing narrow and deterministic.
- **Data exposure**: The visible approval body should contain only low-sensitivity factual signals already available on the publish path, plus the existing marker; it must not expose prompt internals, secret-bearing tool output, or raw hidden context.
- **Input trust**: `result.resultText`, approve-via-comment bodies, PR metadata, file counts, and approval-confidence strings are all untrusted until the shared builder or sanitizer normalizes them into the approved-review grammar.

## Requirement Impact

- **Requirements touched**: R043 — explicit `@kodiai review` requests must still execute the review lane and publish exactly one visible GitHub outcome.
- **Re-verify**: explicit mention clean approval publish, automatic clean-review approval publish, review-output marker continuity/idempotency, and approve-via-comment promotion to `APPROVE` for valid clean approvals.
- **Decisions revisited**: D098, D116.

## Proof Level

- This slice proves: integration.
- Real runtime required: no.
- Human/UAT required: no.

## Verification

- `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: existing `review-output-idempotency`, `explicit-review-publish`, `auto-approve`, and approve-via-comment publish logs should continue to expose publish attempts/skips under the same `reviewOutputKey`.
- Inspection surfaces: focused handler/MCP regression tests and the published review body marker extracted by `extractReviewOutputKey(...)`.
- Failure visibility: regressions should show up as missing marker/body-shape assertions, invalid approval-promotion assertions, or wrapper-only body expectations still firing.
- Redaction constraints: evidence lines must stay factual and derived from already-available counts/confidence summaries, not prompt excerpts or secret-bearing tool output.

## Integration Closure

- Upstream surfaces consumed: `src/handlers/review-idempotency.ts`, `src/handlers/mention.ts`, `src/handlers/review.ts`, `src/execution/mcp/comment-server.ts`, and `src/execution/mention-prompt.ts`.
- New wiring introduced in this slice: both clean approval publishers and the approve-via-comment validator/prompt converge on one visible approved-review grammar with the existing marker contract.
- What remains before the milestone is truly usable end-to-end: S02 must prove the shipped body on live/audit surfaces and confirm operator trust/auditability behavior outside unit tests.

## Tasks

- [x] **T01: Define the canonical visible clean-approval body contract** `est:75m`
  - Why: The existing helper already owns the marker/idempotency seam, so this is the narrowest place to replace wrapper-only approval bodies with the shared D098 contract.
  - Files: `src/handlers/review-idempotency.ts`, `src/handlers/review-idempotency.test.ts`
  - Do: Update `buildApprovedReviewBody(...)` to emit visible plain markdown with `Decision: APPROVE`, `Issues: none`, an `Evidence:` header, 1–3 normalized factual bullets, and the existing review-output marker; keep optional approval-confidence support as structured evidence.
  - Verify: `bun test ./src/handlers/review-idempotency.test.ts`
  - Done when: Focused helper tests pin the new grammar, marker continuity, optional confidence handling, and the assumption that clean approvals are no longer wrapped in `<details>`.

- [x] **T02: Adopt the shared approval body in explicit and automatic review publishers** `est:2h`
  - Why: The milestone demo is only true when both explicit `@kodiai review` approvals and automatic clean-review approvals publish the same visible evidence-backed body.
  - Files: `src/handlers/mention.ts`, `src/handlers/mention.test.ts`, `src/handlers/review.ts`, `src/handlers/review.test.ts`
  - Do: Thread deterministic lane facts into the shared builder from `mention.ts` and `review.ts`, preserve the existing publish/idempotency gates, and keep dep-bump approval confidence visible as evidence instead of regressing to marker-only approvals.
  - Verify: `bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts`
  - Done when: Handler tests prove both lanes publish the shared approval body with marker + evidence lines and still skip duplicate publication when output already exists.

- [x] **T03: Align approve-via-comment validation and prompt guidance to the shared grammar** `est:90m`
  - Why: Approve-via-comment is the strictest boundary and will silently diverge unless the sanitizer, approval promotion check, and prompt guidance all move to the same grammar in the same slice.
  - Files: `src/execution/mcp/comment-server.ts`, `src/execution/mcp/comment-server.test.ts`, `src/execution/mention-prompt.ts`, `src/execution/mention-prompt.test.ts`
  - Do: Narrow `comment-server.ts` to accept only the shared APPROVE grammar with `Evidence:` bullets, keep marker stamping server-side, and update `mention-prompt.ts` so PR approval decisions use the visible approved-review body instead of the old always-`<details>` wrapper.
  - Verify: `bun test ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts`
  - Done when: Tests prove valid shared approval bodies still promote to GitHub `APPROVE` reviews, while extra headings/paragraphs or malformed evidence blocks are rejected.

## Files Likely Touched

- `src/handlers/review-idempotency.ts`
- `src/handlers/review-idempotency.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/execution/mcp/comment-server.ts`
- `src/execution/mcp/comment-server.test.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/mention-prompt.test.ts`
