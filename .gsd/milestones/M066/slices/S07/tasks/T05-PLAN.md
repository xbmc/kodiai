---
estimated_steps: 1
estimated_files: 4
skills_used: []
---

# T05: Capture accepted same-PR formatter suggestion proof

Rerun the controlled formatter smoke against PR #134 or create a fresh controlled PR if needed. Ensure the PR head carries a formatter command when `main` does not. Post `@kodiai format suggestions`, capture the trigger comment id/url, delivery id, formatter reviewOutputKey, Kodiai Pull Request Review id/url, associated fenced suggestion review comment id/url, posted/skipped/capped/publisher status fields, active revision, and bounded logs. Update `docs/smoke/m066-formatter-suggestions.md` from bounded decline to accepted proof only if all required fields exist.

## Inputs

- `T04 deployed revision proof`
- `docs/runbooks/formatter-suggestions.md`
- `scripts/verify-m066-s05.ts`

## Expected Output

- `Updated docs/smoke/m066-formatter-suggestions.md with accepted proof fields`
- `Verifier JSON evidence showing `m066_s05_ok``
- `Requirement evidence suitable for R077/R085 validation`

## Verification

`bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` must return `success: true` and `status_code: "m066_s05_ok"`. Then rerun the deterministic M066 regression bundle from T03.

## Observability Impact

Produces the final live proof surface: formatter action key, same-PR review, suggestion comment, delivery/log correlation, and verifier success.
