# S06: S06 — UAT

**Milestone:** M066
**Written:** 2026-05-05T03:30:32.463Z

## Preconditions

- Controlled PR: `https://github.com/xbmc/kodiai/pull/134`.
- Trigger comment: `https://github.com/xbmc/kodiai/pull/134#issuecomment-4376297998` containing `@kodiai format suggestions`.
- Delivery/log correlation from the smoke attempt: `9961ce70-4830-11f1-86fa-c01e4dffd5b0`, revision `ca-kodiai--deploy-20260504-081420`, ACA job `caj-kodiai-agent-3dzowdd`.
- Smoke artifact: `docs/smoke/m066-formatter-suggestions.md`.

## Test Case 1 — Durable artifact does not claim accepted proof

1. Open `docs/smoke/m066-formatter-suggestions.md`.
2. Confirm the status states the trigger ran but no formatter-suggestion review was produced.
3. Confirm accepted proof fields for formatter Pull Request Review URL/id, suggestion comment URL/id, and accepted verifier output remain blocked/pending or none.

Expected outcome: The artifact is truthful and does not mark final proof checkboxes for same-PR review, marker body, fenced suggestion comment, or verifier pass.

## Test Case 2 — Live GitHub PR surface lacks accepted formatter proof

1. Query PR #134 reviews via GitHub API.
2. Query PR #134 review comments via GitHub API.
3. Filter for reviews/comments authored by Kodiai with `mention-format-suggestions` marker and fenced ```suggestion blocks.

Expected outcome: There are 0 Kodiai formatter reviews and 0 fenced suggestion review comments. Any Copilot review or non-formatter Kodiai issue comment is ignored as invalid proof.

## Test Case 3 — Verifier fails closed without formatter inputs

1. Run `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` with no captured formatter key.
2. Inspect JSON output.

Expected outcome: The verifier returns `success: false` with a bounded invalid-argument status, not a false green. This is the correct result until a real formatter `mention-format-suggestions` key exists.

## Test Case 4 — Deterministic formatter-suggestion regression gates still pass

1. Run `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000`.
2. Run `bunx tsc --noEmit --pretty false`.
3. Run targeted ESLint for mention, formatter orchestration, formatter suggestions, publisher, and verifier files.

Expected outcome: Tests pass, TypeScript emits no errors, and ESLint exits 0. Fresh closer evidence showed 189 passing tests and 0 failures.

## Edge Cases

- Do not accept a non-formatter `action-opened` reviewOutputKey; the verifier correctly rejects wrong actions and delivery mismatches.
- Do not accept issue comments, eyes reactions, generic Kodiai responses, Copilot reviews, or review comments without fenced `suggestion` blocks as same-PR formatter proof.
- Do not mark R077 or R085 validated until a future run captures a COMMENTED Kodiai PR review with the formatter marker and at least one associated fenced suggestion comment, and `verify:m066:s05` returns `m066_s05_ok`.
