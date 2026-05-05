---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T02: Verify GitHub accepted the same-PR suggestion

Inspect GitHub Pull Request Reviews and associated review comments for the captured PR/reviewOutputKey, confirm exactly one matching COMMENTED formatter review body includes the marker, and confirm at least one associated inline review comment contains a fenced `suggestion` block. Run `verify:m066:s05` against the captured evidence and preserve the passing JSON shape.

## Inputs

- `scripts/verify-m066-s05.ts`
- `docs/smoke/m066-formatter-suggestions.md`

## Expected Output

- `Passing `m066_s05_ok` verifier JSON or a named bounded failure with remediation details.`

## Verification

If a delivery id is captured: `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json`. If no delivery id is available: `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --json`. The verifier must return `success: true` and `status_code: "m066_s05_ok"`; also run the focused S05 verifier tests if verifier code changes.

## Observability Impact

Produces machine-readable verifier evidence binding GitHub visible review/comment surfaces to the captured reviewOutputKey and delivery id.
