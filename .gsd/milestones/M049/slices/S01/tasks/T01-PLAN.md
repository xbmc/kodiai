---
estimated_steps: 4
estimated_files: 2
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Define the canonical visible clean-approval body contract

**Slice:** S01 — Shared clean-approval review body contract
**Milestone:** M049

## Description

Define one canonical clean-approval body contract in the existing marker/idempotency module so every publisher consumes the same visible GitHub review format instead of hand-building variants. Assumption for this slice: D098 means clean approvals become visible plain markdown rather than collapsed `<details>` wrappers; if that assumption changes later, the helper and approve-via-comment validator/prompt must be revised together.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/handlers/review-idempotency.ts` shared builder + marker helpers | Fail fast in focused tests instead of letting each handler hand-build divergent approval bodies. | N/A — pure formatter code only. | Normalize or reject empty/overflow evidence inputs in tests so the helper cannot emit arbitrary prose or lose the marker. |
| Existing marker extraction / idempotency contract | Keep marker generation centralized and unchanged so audit correlation still keys off `review-output-key`. | N/A — local helper only. | Treat missing marker, missing `Issues: none`, or missing `Evidence:` as contract regressions caught by tests. |

## Load Profile

- **Shared resources**: one canonical approval-body helper consumed by multiple publishers.
- **Per-operation cost**: one small markdown body assembly with 1–3 evidence bullets and the existing marker.
- **10x breakpoint**: approval bodies become noisy or drift beyond the intended grammar before compute cost matters, so the helper should cap/normalize evidence lines instead of allowing unbounded text.

## Negative Tests

- **Malformed inputs**: empty evidence array, whitespace-only evidence lines, more than three evidence candidates, and optional approval-confidence text with surrounding whitespace.
- **Error paths**: marker accidentally omitted, `Evidence:` header missing, or a lingering `<details>` wrapper after the contract flips to visible markdown.
- **Boundary conditions**: exactly one evidence bullet, exactly three evidence bullets, and approval-confidence inclusion without changing the marker position.

## Steps

1. Extend `src/handlers/review-idempotency.test.ts` first so it pins the new approval-body grammar: visible plain markdown, `Decision: APPROVE`, `Issues: none`, `Evidence:`, 1–3 bullets, optional approval-confidence evidence, and the unchanged `review-output-key` marker.
2. Implement the shared formatter change in `src/handlers/review-idempotency.ts`, keeping marker creation centralized and normalizing evidence lines into a bounded 1–3 bullet contract instead of spreading formatting logic into handlers.
3. Remove the clean-approval dependency on `wrapInDetails(...)` for this helper only, but leave unrelated mention/review thread formatting alone.
4. Re-run the focused helper tests and confirm the old wrapper-only expectations are gone while marker extraction/idempotency helpers still pass.

## Must-Haves

- [ ] `buildApprovedReviewBody(...)` emits visible plain markdown with `Decision: APPROVE`, `Issues: none`, an `Evidence:` block, and the existing marker.
- [ ] The helper keeps approval-confidence support as structured evidence instead of a free-form trailing paragraph.
- [ ] Focused tests pin marker continuity and bounded evidence handling so downstream handlers can adopt the contract safely.

## Verification

- `bun test ./src/handlers/review-idempotency.test.ts`
- Confirm the expected approval body no longer contains `<summary>kodiai response</summary>` or a wrapping `<details>` block.

## Inputs

- `src/handlers/review-idempotency.ts` — existing approved-review builder and marker helpers.
- `src/handlers/review-idempotency.test.ts` — helper-level contract regression coverage.
- `src/lib/formatting.ts` — current wrapper helper that clean approvals are expected to stop using.

## Expected Output

- `src/handlers/review-idempotency.ts` — canonical visible clean-approval builder with bounded evidence normalization.
- `src/handlers/review-idempotency.test.ts` — regression tests for the new grammar, marker continuity, and optional approval-confidence evidence.
