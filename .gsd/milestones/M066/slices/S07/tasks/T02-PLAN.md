---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T02: Pin the live trigger miss with a failing regression

Add the smallest deterministic regression that reproduces the PR #134 failure shape. Prefer extending `src/handlers/mention.test.ts` or `src/handlers/formatter-suggestion-intent.test.ts` with the exact event/comment shape from the smoke: top-level PR issue comment body `@kodiai format suggestions`, PR context, formatter config loaded from the PR head, and expected format-only subflow dispatch without Claude. Run the targeted test and confirm it fails before implementation, unless T01 proves the failure is deployment/config drift not represented in current code; in that case, add a regression around the discovered drift boundary.

## Inputs

- `T01 root-cause note`
- `Existing M066 tests`

## Expected Output

- `Failing regression test committed by auto-mode task completion`
- `Test output showing the pre-fix failure`

## Verification

`bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000` must show the new regression fails before the implementation change, then pass after T03.

## Observability Impact

Pins the live-smoke miss as a deterministic regression so future deploys cannot silently route formatter triggers to conversational handling.
