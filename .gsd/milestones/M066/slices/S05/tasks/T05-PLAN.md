---
estimated_steps: 1
estimated_files: 9
skills_used: []
---

# T05: Run final S05 regression gate with captured live proof

Close S05 only after deterministic regression suites pass and the live verifier succeeds against the captured proof variables from T04. Run the S04 preservation suites, S05 verifier tests, typecheck, targeted lint, and then `bun run verify:m066:s05` using quoted environment variables rather than placeholder text. The live verifier must return `m066_s05_ok` for a real same-PR Pull Request Review in `COMMENTED` state with at least one associated inline fenced `suggestion` comment. If live verification reports missing access, unavailable GitHub API, duplicate reviews, wrong action, wrong delivery id, wrong surface, or no suggestion comments, tighten the proof artifact or retry the live smoke with a fresh trigger comment/new PR head commit; do not mark complete with synthetic or blocked proof.

## Inputs

- `T04 proof-ready smoke artifact`
- `M066_S05_REPO`
- `M066_S05_REVIEW_OUTPUT_KEY`
- `Optional M066_S05_DELIVERY_ID`
- `GitHub App verifier credentials`

## Expected Output

- `All deterministic tests/typecheck/lint pass`
- `Live verifier JSON reports m066_s05_ok for the captured same-PR formatter suggestion review`
- `docs/smoke/m066-formatter-suggestions.md contains durable proof fields matching the verifier output`

## Verification

bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts && bash -lc 'test -n "${M066_S05_REPO:-}" && test -n "${M066_S05_REVIEW_OUTPUT_KEY:-}" && if test -n "${M066_S05_DELIVERY_ID:-}"; then bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json; else bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --json; fi' && rg -n "m066_s05_ok|PR URL|reviewOutputKey|formatter review|suggestion comment|verify:m066:s05|mention-format-suggestions" docs/smoke/m066-formatter-suggestions.md
