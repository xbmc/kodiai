---
estimated_steps: 1
estimated_files: 5
skills_used: []
---

# T03: Fix formatter intent routing at the source

Implement the root-cause fix identified in T01 and proven by T02. Keep the change narrow: fix classification/routing/config propagation at the source boundary, not by adding a broad fallback in the publisher or verifier. Preserve existing invariants: format-only stays read-only and bypasses Claude; combined review+format preserves normal review routing; formatter command/output remains deterministic; no branch pushes/new PRs/bot commits are introduced. Add or adjust structured logs only if the failing boundary lacked enough signal to diagnose future misses.

## Inputs

- `T01 root-cause note`
- `T02 failing test`

## Expected Output

- `Source fix in the root-cause file(s)`
- `Updated tests passing for formatter intent/routing`
- `Bounded structured log field if needed`

## Verification

`bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts`

## Observability Impact

Ensures future mention completions expose formatter classification/subflow status rather than looking like generic conversation success.
