---
estimated_steps: 1
estimated_files: 1
skills_used: []
---

# T04: Verify GitHub accepted the same-PR suggestion

Inspect GitHub Pull Request Reviews and associated review comments for the captured PR and formatter reviewOutputKey. Confirm exactly one matching Kodiai formatter Pull Request Review has COMMENTED state, includes the expected marker/idempotency body, and has at least one associated inline review comment containing a fenced `suggestion` block that GitHub accepted on the same PR. Run the existing verifier with the actual syntax and captured non-secret inputs, preserving the passing bounded JSON result.

## Inputs

- `T03 live trigger evidence bundle`
- `scripts/verify-m066-s05.ts`
- `scripts/verify-m066-s05.test.ts`
- `GitHub PR reviews/comments API or equivalent authenticated GitHub access`

## Expected Output

- `A verifier JSON excerpt proving `m066_s05_ok``
- `Review URL/id and suggestion comment URL/id for at least one accepted same-PR fenced suggestion`
- `Bounded notes for any skipped/capped formatter hunks if visible`

## Verification

`bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` returns `success: true` and `status_code: "m066_s05_ok"`; also run `bun test ./scripts/verify-m066-s05.test.ts --timeout 30000` if verifier code or assumptions change.
