---
id: T02
parent: S05
milestone: M066
key_files:
  - docs/configuration.md
  - docs/runbooks/formatter-suggestions.md
  - docs/runbooks/mentions.md
  - docs/README.md
  - docs/INDEX.md
  - README.md
  - docs/smoke/m066-formatter-suggestions.md
key_decisions:
  - Documented `review.formatterSuggestions.automatic` as parsed but reserved, and avoided claiming normal automatic PR reviews publish formatter suggestions.
  - Kept the same-PR Pull Request Review with fenced `suggestion` comments as the required proof surface; issue comments and standalone comments are not documented as sufficient proof.
duration: 
verification_result: passed
completed_at: 2026-05-05T01:43:09.864Z
blocker_discovered: false
---

# T02: Documented explicit formatter-suggestion configuration, operator smoke workflow, and fillable M066 proof record.

**Documented explicit formatter-suggestion configuration, operator smoke workflow, and fillable M066 proof record.**

## What Happened

Added operator-facing formatter-suggestion documentation for maintainers and on-call agents. Updated the configuration reference quick-start and review section with `review.formatterSuggestions.automatic`, `command`, and `maxSuggestions`, explicitly preserving the current support boundary that automatic-review formatter suggestions are not live. Created a dedicated formatter-suggestions runbook covering setup, safe smoke PR shape, explicit format-only and combined review-and-format triggers, same-PR Pull Request Review proof, retry/idempotency, Azure Container Apps log fields, verifier usage, and failure interpretation. Created a fillable M066 smoke proof template with slots for repo, PR URL, trigger URL, delivery id, reviewOutputKey, deployed revision, formatter review/comment identifiers, verifier output, log query, and screenshot URL. Cross-linked the runbook and proof template from the mentions runbook, docs index, docs README, and top-level README.

## Verification

Ran the task acceptance grep for required terms across all touched docs, the focused M066 S05 verifier tests, the full slice formatter-suggestion regression bundle, project typecheck, and targeted ESLint for the slice code/test surfaces. All executable checks passed. The deployed live smoke command `bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-mention-format-suggestions-key> --delivery-id <captured-delivery-id> --json` was not run because this docs task does not have captured deployed PR artifact values; the new runbook and proof template document how operators capture and run it.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `test -s docs/runbooks/formatter-suggestions.md && test -s docs/smoke/m066-formatter-suggestions.md && rg -n "formatterSuggestions|format suggestions|verify:m066:s05|mention-format-suggestions|skipped|capped|publisherFailed|automatic" README.md docs/configuration.md docs/runbooks/formatter-suggestions.md docs/runbooks/mentions.md docs/README.md docs/INDEX.md docs/smoke/m066-formatter-suggestions.md` | 0 | ✅ pass | 5ms |
| 2 | `bun test ./scripts/verify-m066-s05.test.ts --timeout 30000` | 0 | ✅ pass | 59ms |
| 3 | `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000` | 0 | ✅ pass | 6567ms |
| 4 | `bunx tsc --noEmit --pretty false` | 0 | ✅ pass | 8994ms |
| 5 | `bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts` | 0 | ✅ pass | 600ms |

## Deviations

None.

## Known Issues

The GSD memory store was unavailable: `memory_query` failed with `database disk image is malformed`, and `capture_thought` also failed. The task proceeded using the task plan and repository evidence. No documentation implementation issues remain known.

## Files Created/Modified

- `docs/configuration.md`
- `docs/runbooks/formatter-suggestions.md`
- `docs/runbooks/mentions.md`
- `docs/README.md`
- `docs/INDEX.md`
- `README.md`
- `docs/smoke/m066-formatter-suggestions.md`
