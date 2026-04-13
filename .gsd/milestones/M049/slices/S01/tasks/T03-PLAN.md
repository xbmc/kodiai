---
estimated_steps: 4
estimated_files: 4
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T03: Align approve-via-comment validation and prompt guidance to the shared grammar

**Slice:** S01 — Shared clean-approval review body contract
**Milestone:** M049

## Description

Approve-via-comment is the strictest migration boundary because it both validates model-authored approval bodies and promotes clean approvals into GitHub `APPROVE` reviews. Keep the validator narrow: accept only the same visible clean-approval grammar that T01/T02 publish, keep marker stamping server-side, and do not widen scope into unrelated inline-thread response formatting.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/execution/mcp/comment-server.ts` sanitizer + approval promotion | Reject malformed approved bodies with explicit validation errors instead of posting arbitrary prose or silently promoting it. | Use the existing GitHub publish path; do not add retries or extra polling. | Require the shared `Decision` / `Issues: none` / `Evidence:` grammar with 1–3 bullets and keep server-side marker stamping deterministic. |
| `src/execution/mention-prompt.ts` PR approval instructions | Update the prompt in the same slice so models stop emitting the old wrapped two-line approval format. | Keep prompt changes local; no additional runtime network work. | Treat wrapper-only or extra-prose approval instructions as prompt regressions pinned by tests. |

## Load Profile

- **Shared resources**: approve-via-comment GitHub publish path, outgoing mention sanitizer, and prompt token budget for PR approvals.
- **Per-operation cost**: one sanitized publish attempt plus narrow approval grammar parsing.
- **10x breakpoint**: repeated retries or verbose approval prose create confusion/noise before raw compute cost matters, so the prompt and validator should stay short, explicit, and grammar-bounded.

## Negative Tests

- **Malformed inputs**: missing `Evidence:` header, zero evidence bullets, more than three evidence bullets, and wrapper-only approval bodies that still carry the old `<details>` shape.
- **Error paths**: extra headings or paragraphs, invalid decision values, or arbitrary prose after `Issues: none` all fail validation and do not promote to `APPROVE`.
- **Boundary conditions**: one-bullet and three-bullet clean approvals still promote successfully, and marker stamping remains server-side for valid approvals.

## Steps

1. Update `src/execution/mcp/comment-server.test.ts` and `src/execution/mention-prompt.test.ts` first so they pin the new visible APPROVE grammar and reject the old permissive/legacy near-miss shapes.
2. Change `sanitizeKodiaiDecisionResponse(...)` and the approval-promotion detection in `src/execution/mcp/comment-server.ts` to require `Decision: APPROVE`, `Issues: none`, `Evidence:`, and 1–3 bullets, while keeping marker stamping deterministic and server-side.
3. Update `src/execution/mention-prompt.ts` so PR approval decisions use the shared visible grammar instead of the old always-`<details>` wrapper, while leaving other conversational mention responses on their existing wrapper contract.
4. Re-run the focused MCP/prompt suites and confirm valid shared clean approvals still become GitHub `APPROVE` reviews while arbitrary prose is rejected.

## Must-Haves

- [ ] Approve-via-comment accepts the shared visible clean-approval grammar and still promotes valid clean approvals to GitHub `APPROVE` reviews.
- [ ] Extra headings, paragraphs, or malformed evidence blocks are rejected instead of being published or promoted.
- [ ] PR approval prompt instructions match the shipped shared grammar so the model stops generating the legacy wrapped two-line approval shape.

## Verification

- `bun test ./src/execution/mcp/comment-server.test.ts ./src/execution/mention-prompt.test.ts`
- Confirm the focused tests cover both successful promotion of valid shared approval bodies and rejection of arbitrary prose after `Issues: none`.

## Observability Impact

- Signals added/changed: approve-via-comment tests now differentiate sanitizer rejection, server-side marker stamping, and promotion-to-`APPROVE` review behavior under the shared grammar.
- How a future agent inspects this: run the focused MCP/prompt suites and inspect the failing validation message or missing approval-promotion assertion.
- Failure state exposed: regressions remain visible as explicit validation failures or promotion mismatches instead of silently allowing arbitrary prose to publish.

## Inputs

- `src/handlers/review-idempotency.ts` — shared approval-body contract from T01.
- `src/execution/mcp/comment-server.ts` — approve-via-comment sanitizer and promotion logic.
- `src/execution/mcp/comment-server.test.ts` — approve-via-comment validation and promotion regressions.
- `src/execution/mention-prompt.ts` — PR approval prompt instructions.
- `src/execution/mention-prompt.test.ts` — prompt contract regressions.

## Expected Output

- `src/execution/mcp/comment-server.ts` — narrow validator/promotion logic for the shared visible clean-approval grammar.
- `src/execution/mcp/comment-server.test.ts` — regressions for valid promotion plus arbitrary-prose rejection.
- `src/execution/mention-prompt.ts` — PR approval prompt guidance aligned to the shared visible grammar.
- `src/execution/mention-prompt.test.ts` — tests proving the prompt no longer instructs the legacy wrapped approval format.
