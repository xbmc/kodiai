# S06: S06

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

- [x] **T01: Blocked live formatter-suggestion trigger because no authenticated GitHub operator credentials are available in auto-mode.** `est:1h`
  Prepare a safe controlled PR or identify an existing test PR with a small formatting-only diff, verify deployed Kodiai is available, and trigger `@kodiai format suggestions`. Capture the trigger comment URL, delivery id if accessible, repo/PR identity, and the formatter-specific reviewOutputKey from logs or visible output. Do not store secrets.
  - Files: `docs/smoke/m066-formatter-suggestions.md`
  - Verify: Confirm captured fields include repo, PR URL, trigger comment URL, reviewOutputKey with `mention-format-suggestions`, and either delivery id/log correlation or a documented reason the delivery id is unavailable.

- [x] **T02: Establish credentialed smoke gate and controlled PR** `est:45m`
  Resolve the T01 environment blocker before attempting another live smoke. Verify whether a credentialed operator path is available through secure environment collection or already-present CI/operator environment variables without printing secret values. Required capability is one authenticated path that can post a PR comment/trigger and read PR reviews/comments for the selected repo. Establish or identify a safe controlled PR with a small formatting-only diff, and capture non-secret prerequisites: repo, PR URL/number, branch/head SHA, deployed environment/revision or log stream identifier, and which auth path is active. If no authenticated path is available after secure collection/gating, stop with a blocker summary rather than modifying proof docs or fabricating evidence.
  - Files: `docs/smoke/m066-formatter-suggestions.md`
  - Verify: Confirm non-secret smoke prerequisites are captured: repo, PR URL/number, controlled formatting diff description, deployed revision/log correlation target, and an authenticated write/read path is available without exposing tokens. If unavailable, record a blocker and do not proceed to trigger/verification tasks.

- [ ] **T03: Trigger authenticated formatter-suggestion smoke** `est:45m`
  Using the credentialed path and controlled PR from T02, post or otherwise create the explicit `@kodiai format suggestions` trigger in the deployed/operator environment. Capture only non-secret evidence: trigger comment URL/id, repo, PR URL/number, delivery id if available, deployed revision/log correlation, formatter-specific reviewOutputKey containing the `mention-format-suggestions` intent, formatter subflow status fields, and any bounded failure reason if Kodiai declines to publish. Do not store secrets, raw formatter stdout, private keys, tokens, or full webhook payloads.
  - Files: `docs/smoke/m066-formatter-suggestions.md`
  - Verify: Confirm captured fields include repo, PR URL, trigger comment URL/id, reviewOutputKey containing `mention-format-suggestions`, deployed revision/log correlation, formatter subflow status, and either delivery id or a documented reason delivery id is unavailable.

- [ ] **T04: Verify GitHub accepted the same-PR suggestion** `est:45m`
  Inspect GitHub Pull Request Reviews and associated review comments for the captured PR and formatter reviewOutputKey. Confirm exactly one matching Kodiai formatter Pull Request Review has COMMENTED state, includes the expected marker/idempotency body, and has at least one associated inline review comment containing a fenced `suggestion` block that GitHub accepted on the same PR. Run the existing verifier with the actual syntax and captured non-secret inputs, preserving the passing bounded JSON result.
  - Files: `docs/smoke/m066-formatter-suggestions.md`
  - Verify: `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` returns `success: true` and `status_code: "m066_s05_ok"`; also run `bun test ./scripts/verify-m066-s05.test.ts --timeout 30000` if verifier code or assumptions change.

- [ ] **T05: Record accepted smoke proof and revalidate milestone** `est:45m`
  Replace blocked placeholders in `docs/smoke/m066-formatter-suggestions.md` with the accepted live proof fields from T02-T04: repo, PR URL, trigger comment URL, review URL/id, suggestion comment URL/id, reviewOutputKey, delivery id or delivery-unavailable reason, deployed revision/log correlation, formatter subflow status summary, and bounded verifier JSON. Preserve the no-secrets/no-raw-stdout rule. Re-run deterministic M066 tests/typecheck/lint, then update GSD requirement validation only where the accepted evidence directly supports the requirement. Do not claim live proof if the verifier did not return `m066_s05_ok`.
  - Files: `docs/smoke/m066-formatter-suggestions.md`, `.gsd/REQUIREMENTS.md`
  - Verify: `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts`

## Files Likely Touched

- docs/smoke/m066-formatter-suggestions.md
- .gsd/REQUIREMENTS.md
