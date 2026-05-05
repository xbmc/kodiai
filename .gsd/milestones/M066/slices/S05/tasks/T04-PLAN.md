---
estimated_steps: 4
estimated_files: 8
skills_used:
  - test
  - lint
  - verify-before-complete
---

# T04: Run final S05 regression gate and tighten proof artifacts

skills_used frontmatter expectation: `test`, `lint`, `verify-before-complete`.

Close the slice by running the deterministic S04 preservation suites, the new S05 verifier tests, type checking, targeted lint, and the live verifier command captured in the smoke artifact. Tighten docs or verifier output only if verification exposes drift. This task exists to preserve R080/R084 while S05 proves R085, and to ensure the final docs/proof bundle is internally consistent.

Failure Modes (Q5): Regression failures mean a docs/verifier edit accidentally broke runtime code or type contracts; live verifier failure means the proof artifact is insufficient or the GitHub smoke did not produce a committable same-PR suggestion. Do not mark complete until the failing command is fixed or the proof artifact records a real blocker.

Negative Tests (Q7): Ensure `scripts/verify-m066-s05.test.ts` still covers invalid args, wrong action, wrong surface, duplicate matches, no suggestion comments, and missing GitHub env; ensure the final live command is the positive proof.

## Inputs

- `scripts/verify-m066-s05.ts`
- `scripts/verify-m066-s05.test.ts`
- `package.json`
- `docs/runbooks/formatter-suggestions.md`
- `docs/smoke/m066-formatter-suggestions.md`
- `src/handlers/mention.test.ts`
- `src/handlers/formatter-suggestion-orchestration.test.ts`
- `src/execution/formatter-suggestions.test.ts`
- `src/execution/formatter-suggestion-publisher.test.ts`

## Expected Output

- `scripts/verify-m066-s05.ts`
- `scripts/verify-m066-s05.test.ts`
- `package.json`
- `docs/runbooks/formatter-suggestions.md`
- `docs/smoke/m066-formatter-suggestions.md`

## Verification

bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts && bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-mention-format-suggestions-key> --delivery-id <captured-delivery-id> --json

## Observability Impact

Confirms the final operator-visible signals and proof commands are fresh before closure; no new runtime observability should be added here unless verification exposes a gap.
