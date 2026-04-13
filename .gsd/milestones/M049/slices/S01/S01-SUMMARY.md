---
id: S01
parent: M049
milestone: M049
provides:
  - One canonical visible clean-approval body contract shared by explicit mention, automatic review, and approve-via-comment approval lanes.
  - A strict approve-via-comment grammar boundary that promotes only valid visible APPROVE bodies while keeping marker stamping server-side.
  - Preserved idempotency, marker extraction, and publish-log correlation around clean approvals despite the visible body change.
requires:
  []
affects:
  - S02
key_files:
  - src/handlers/review-idempotency.ts
  - src/handlers/review-idempotency.test.ts
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - src/execution/mcp/comment-server.ts
  - src/execution/mcp/comment-server.test.ts
  - src/execution/mention-prompt.ts
  - src/execution/mention-prompt.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D098 — use one shared short evidence-backed GitHub review body for clean approvals instead of a marker-only approval or separate clean comment.
  - D116 — define that shared clean-approval body as visible plain markdown with `Decision: APPROVE`, `Issues: none`, an `Evidence:` block with 1–3 factual bullets, and the existing marker.
  - D117 — require approve-via-comment to accept and promote only that visible APPROVE grammar while leaving the wrapped `Decision: NOT APPROVED` path unchanged.
patterns_established:
  - Use `buildApprovedReviewBody(...)` as the sole formatter for clean approvals and feed it only facts handlers already compute, not fresh API calls or prompt excerpts.
  - Reserve at most one evidence slot for approval confidence so visible clean approvals stay short, structured, and bounded at 1–3 bullets.
  - Treat approve-via-comment as a narrow validation boundary: the server stamps the marker, the prompt teaches the exact grammar, and the sanitizer rejects wrapped or prose-heavy near-misses.
observability_surfaces:
  - `review-output-idempotency` log gating and `extractReviewOutputKey(...)` marker extraction continue to correlate clean approval publication under the same `reviewOutputKey`.
  - Explicit mention publish tests assert approval submission logs and publish-attempt outcomes under the shared key.
  - Automatic review tests continue to cover `auto-approve` publication behavior and dep-bump approval confidence inside the shared body.
  - Comment-server tests prove server-stamped marker continuity on valid APPROVE promotion and explicit rejection on malformed approval bodies.
drill_down_paths:
  - .gsd/milestones/M049/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M049/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M049/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-13T14:56:18.391Z
blocker_discovered: false
---

# S01: Shared clean-approval review body contract

**Unified clean GitHub approvals across explicit mention, automatic review, and approve-via-comment onto one visible evidence-backed APPROVE body while preserving marker, idempotency, and publish-log continuity.**

## What Happened

## Delivered

This slice replaced marker-only clean approvals with one shared visible review-body contract and threaded that contract through every clean-approval publish path covered by the milestone demo.

- `src/handlers/review-idempotency.ts` now makes `buildApprovedReviewBody(...)` the canonical formatter for clean approvals. The body is visible plain markdown, not a `<details>` wrapper, and always emits `Decision: APPROVE`, `Issues: none`, an `Evidence:` header, 1–3 short factual bullets, and the existing `<!-- kodiai:review-output-key:... -->` marker.
- The evidence builder normalizes/trims inputs, falls back to one default factual bullet when no evidence is supplied, and reserves one slot for optional approval-confidence text so dep-bump merge confidence stays structured instead of trailing as free-form prose.
- `src/handlers/mention.ts` now publishes explicit `@kodiai review` clean approvals through the shared formatter using facts the handler already computes: review-prompt file coverage and repo-inspection-tool usage. The explicit-review publish bridge still runs through the same idempotency gate and keeps the same `reviewOutputKey` correlation contract.
- `src/handlers/review.ts` now publishes automatic clean approvals through the same formatter, carrying forward changed-file coverage evidence and rendering dep-bump merge confidence as a shared evidence bullet instead of marker-only approval text.
- `src/execution/mcp/comment-server.ts` now treats approve-via-comment as the strict boundary for this contract: valid APPROVE responses must use the visible shared grammar, must contain exactly the `Decision: APPROVE` / `Issues: none` / `Evidence:` structure with 1–3 bullets, and must not include wrapper HTML or extra prose. The server continues to stamp the review-output marker itself.
- `src/execution/mention-prompt.ts` now teaches the same narrow visible APPROVE grammar while preserving the wrapped `Decision: NOT APPROVED` contract for non-clean outcomes.

## What the slice actually proved

Fresh slice-close verification proved the contract end to end in code:

- helper tests pin the exact clean-approval grammar, fallback evidence, evidence normalization, three-bullet cap, approval-confidence handling, and marker extraction continuity;
- explicit mention approval bridging publishes the shared body and keeps `review-output-idempotency`-backed duplicate suppression intact;
- automatic clean-review approval publishing uses the same visible body, including the dep-bump approval-confidence path;
- approve-via-comment promotes only valid shared APPROVE bodies to GitHub `APPROVE` reviews and rejects wrapped or malformed near-misses;
- prompt guidance, sanitizer rules, and server-side marker stamping now agree on one narrow approval grammar.

This slice intentionally stopped at integration-level proof. S02 still needs live GitHub/operator proof that the shipped body appears as expected on real approval surfaces and remains easy to audit outside unit tests.

## Operational Readiness (Q8)

- **Health signal:** handler/MCP tests confirm valid clean approvals carry the same `reviewOutputKey`, `extractReviewOutputKey(...)` still resolves the published marker, and the existing publish-path logs continue to emit `review-output-idempotency`, explicit approval submission, and automatic approval publication under the same correlation key.
- **Failure signal:** a regression shows up as missing marker/body assertions, malformed `Evidence:` block rejection, wrapped APPROVE-body rejection, lost dep-bump confidence evidence, or publish-log assertions failing on the explicit/automatic approval paths.
- **Recovery procedure:** rerun the full S01 slice test command plus `bun run tsc --noEmit`, inspect which of the three seams drifted (`buildApprovedReviewBody(...)`, handler evidence wiring, or comment-server/prompt grammar enforcement), then restore the shared contract before redeploying.
- **Monitoring gaps:** this slice did not produce fresh live GitHub proof. S02 still needs to inspect a real clean approval on GitHub and verify the same body is operator-visible and audit-correlatable outside the test harness.

## Requirements

- **Advanced:** R043 — reverified that the explicit `@kodiai review` clean-approval lane still produces exactly one visible GitHub review outcome while moving that outcome from marker-only approval text to the shared evidence-backed body.
- **New requirements surfaced:** None.
- **Requirements invalidated or re-scoped:** None.

## Deviations

None.

## Known Limitations

This slice proves the shared clean-approval contract in tests and typecheck only. It does not yet include fresh live GitHub proof of the visible body on real approval reviews; that remains the purpose of S02.

## Follow-ups

Use S02 to capture live clean-approval examples from both explicit mention and automatic review lanes, confirm the visible body on GitHub, and verify operator/audit tooling can correlate the same published body cleanly.

## Verification

- `bun test ./src/handlers/review-idempotency.test.ts ./src/handlers/mention.test.ts ./src/handlers/review.test.ts ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts` — passed fresh at slice close (322 pass, 0 fail).
- `bun run tsc --noEmit` — passed fresh at slice close (exit 0).
- Observability/diagnostic surfaces were reverified through assertions on `review-output-idempotency`, explicit approval publish logs, automatic approval publication, server-stamped marker continuity, and `extractReviewOutputKey(...)` extraction across published approval bodies.

## Requirements Advanced

- R043 — Reverified the explicit `@kodiai review` clean-approval lane still publishes exactly one visible GitHub review outcome while switching that outcome to the shared evidence-backed APPROVE body and preserving idempotency.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

Live GitHub proof is intentionally deferred to S02; this slice only proves the contract locally via focused integration tests and typecheck.

## Follow-ups

S02 should capture real GitHub clean-approval examples from explicit mention and automatic review lanes, then verify audit/operator surfaces against the published body.

## Files Created/Modified

- `src/handlers/review-idempotency.ts` — Made `buildApprovedReviewBody(...)` the canonical visible clean-approval formatter, including bounded evidence normalization, approval-confidence handling, and unchanged marker generation/extraction.
- `src/handlers/mention.ts` — Threaded explicit mention approval evidence into the shared builder and preserved publish/idempotency correlation for clean approval bridging.
- `src/handlers/review.ts` — Switched automatic clean approvals and dep-bump approval confidence onto the shared visible APPROVE body.
- `src/execution/mcp/comment-server.ts` — Tightened approve-via-comment sanitization and promotion so only the shared visible APPROVE grammar can become a GitHub `APPROVE` review.
- `src/execution/mention-prompt.ts` — Updated PR-approval instructions to teach the visible APPROVE grammar while preserving the wrapped NOT APPROVED contract.
- `.gsd/KNOWLEDGE.md` — Recorded the marker-bearing comment-server test gotcha so future work stubs the idempotency scan endpoints before approval publish assertions.
