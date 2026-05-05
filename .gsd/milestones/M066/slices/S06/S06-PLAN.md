# S06: Live formatter-suggestion acceptance proof

**Goal:** Produce the missing live GitHub acceptance proof for M066 by running an authenticated formatter-suggestion smoke, capturing the same-PR Pull Request Review and fenced suggestion evidence, updating the durable smoke artifact, and proving it with `verify:m066:s05`.
**Demo:** After this: M066 has a real authenticated/deployed smoke proof showing GitHub accepted at least one Kodiai-generated same-PR formatter suggestion, and `verify:m066:s05` returns `m066_s05_ok` for the captured evidence.

## Must-Haves

- A controlled PR receives an explicit `@kodiai format suggestions` trigger in an authenticated deployed/operator environment.
- GitHub shows a same-PR Pull Request Review from Kodiai with COMMENTED state and at least one associated review comment containing a fenced `suggestion` block.
- The proof captures repo, PR URL, review URL/id, suggestion comment URL/id, reviewOutputKey, optional delivery id, and deployed revision/log correlation.
- `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` returns `success: true` and `status_code: "m066_s05_ok"`.
- `docs/smoke/m066-formatter-suggestions.md` no longer claims blocked proof and contains the real accepted evidence without secrets or raw formatter output.

## Proof Level

- This slice proves: live authenticated smoke plus deterministic verifier

## Integration Closure

The slice closes only when the captured evidence satisfies the existing S05 verifier with `status_code: "m066_s05_ok"`, the smoke artifact contains real proof fields instead of blocked placeholders, and milestone validation can be rerun without the live-proof failure.

## Verification

- Captures reviewOutputKey, delivery id, deployed revision/log correlation, formatter subflow status fields, and verifier JSON so operators and future agents can audit the live proof without secrets.

## Tasks

- [x] **T01: Trigger authenticated formatter-suggestion smoke** `est:1h`
  Prepare a safe controlled PR or identify an existing test PR with a small formatting-only diff, verify deployed Kodiai is available, and trigger `@kodiai format suggestions`. Capture the trigger comment URL, delivery id if accessible, repo/PR identity, and the formatter-specific reviewOutputKey from logs or visible output. Do not store secrets.
  - Files: `docs/smoke/m066-formatter-suggestions.md`
  - Verify: Confirm captured fields include repo, PR URL, trigger comment URL, reviewOutputKey with `mention-format-suggestions`, and either delivery id/log correlation or a documented reason the delivery id is unavailable.

- [ ] **T02: Verify GitHub accepted the same-PR suggestion** `est:45m`
  Inspect GitHub Pull Request Reviews and associated review comments for the captured PR/reviewOutputKey, confirm exactly one matching COMMENTED formatter review body includes the marker, and confirm at least one associated inline review comment contains a fenced `suggestion` block. Run `verify:m066:s05` against the captured evidence and preserve the passing JSON shape.
  - Files: `docs/smoke/m066-formatter-suggestions.md`
  - Verify: `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" -- --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` must be corrected/run with the actual verifier syntax and return `status_code: "m066_s05_ok"`; also run the focused S05 verifier tests if verifier code changes.

- [ ] **T03: Record accepted smoke proof and revalidate milestone** `est:45m`
  Replace the blocked placeholders in `docs/smoke/m066-formatter-suggestions.md` with the real accepted proof fields and bounded verifier output, preserving the no-secrets/no-raw-stdout rule. Re-run deterministic M066 checks and update requirement validation only where supported by evidence.
  - Files: `docs/smoke/m066-formatter-suggestions.md`, `.gsd/REQUIREMENTS.md`
  - Verify: `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts`

## Files Likely Touched

- docs/smoke/m066-formatter-suggestions.md
- .gsd/REQUIREMENTS.md
