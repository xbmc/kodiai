---
id: S05
parent: M066
milestone: M066
provides:
  - A machine-readable verifier for the required live proof.
  - Operator documentation for configuring, triggering, verifying, and troubleshooting formatter suggestions.
  - A blocked proof artifact that prevents downstream agents from mistaking missing access for accepted live proof.
requires:
  []
affects:
  - M066 milestone validation: R085 live proof must remain needs-remediation/blocked until `m066_s05_ok` exists.
  - Future automatic-mode work: docs/config shape are present but runtime automatic-review inclusion is not claimed.
key_files:
  - scripts/verify-m066-s05.ts
  - scripts/verify-m066-s05.test.ts
  - package.json
  - docs/configuration.md
  - docs/runbooks/formatter-suggestions.md
  - docs/runbooks/mentions.md
  - docs/README.md
  - docs/INDEX.md
  - README.md
  - docs/smoke/m066-formatter-suggestions.md
key_decisions:
  - Only same-PR Pull Request Reviews with COMMENTED state and associated fenced suggestion review comments satisfy formatter-suggestion proof.
  - Missing GitHub App credentials and GitHub API failures are reported as named bounded verifier statuses without printing secrets.
  - `review.formatterSuggestions.automatic` is documented as parsed/defaulted and reserved, not as live automatic-review behavior.
  - Blocked live proof is recorded explicitly instead of exporting placeholder proof variables or fabricating `m066_s05_ok`.
patterns_established:
  - Verifier-first operational proof for GitHub committable suggestions with pre-network argument validation.
  - Operator smoke artifacts distinguish accepted proof from blocked/missing-access states.
  - Formatter-suggestion docs surface skipped/capped/publisher failure fields and avoid raw formatter stdout or unbounded stderr.
observability_surfaces:
  - `verify:m066:s05` JSON statuses: `m066_s05_ok`, `m066_s05_missing_github_access`, and bounded GitHub unavailable/fail-closed issue lists.
  - Formatter subflow log/result fields: formatterStatus, commandStatus, publisherStatus, suggestions, skipped, capped, posted, publisherSkipped, publisherFailed, deliveryId, and reviewOutputKey.
  - docs/smoke/m066-formatter-suggestions.md records proof fields, missing access surfaces, retry path, and expected verifier output.
drill_down_paths:
  - .gsd/milestones/M066/slices/S05/tasks/T01-SUMMARY.md
  - .gsd/milestones/M066/slices/S05/tasks/T02-SUMMARY.md
  - .gsd/milestones/M066/slices/S05/tasks/T03-SUMMARY.md
  - .gsd/milestones/M066/slices/S05/tasks/T04-SUMMARY.md
  - .gsd/milestones/M066/slices/S05/tasks/T05-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-05-05T01:56:18.427Z
blocker_discovered: false
---

# S05: S05

**S05 delivered the formatter-suggestion live-proof verifier, operator documentation, and durable smoke-proof record, while truthfully recording that accepted live GitHub proof remains blocked in this unauthenticated environment.**

## What Happened

S05 assembled the final operational proof surface for Same-PR Formatter Suggestions. T01 added `scripts/verify-m066-s05.ts`, its focused negative/happy-path test suite, and the `verify:m066:s05` package script. The verifier validates `--repo`, `--review-output-key`, optional `--delivery-id`, and JSON/help flags; rejects malformed, wrong-action, repo-mismatched, and delivery-mismatched inputs before network access; authenticates with GitHub App credentials without printing secret values; scans only the PR encoded by the review-output key; requires exactly one matching Pull Request Review body containing the formatter review-output marker; requires `COMMENTED` review state; and requires at least one associated inline review comment containing a fenced GitHub `suggestion` block. T02 added the operator-facing configuration reference and formatter-suggestions runbook, cross-linked them from the docs index, docs README, mentions runbook, and top-level README, and created the durable M066 smoke proof template. The docs explicitly keep `review.formatterSuggestions.automatic` as parsed/defaulted and reserved for later automatic-review inclusion rather than claiming that normal automatic PR reviews publish formatter suggestions today. T03-T05 attempted to convert the template into live proof, but the environment lacked a captured formatter delivery bundle and GitHub/Azure operator credentials. Instead of fabricating evidence, the smoke artifact now records a blocked proof state, exact missing access surfaces, a synthetic verifier probe that failed closed, bounded retry commands, expected `m066_s05_ok` shape, and the fields operators must capture from a real same-PR formatter Pull Request Review and suggestion comment. Deterministic S04/S05 regression suites, typecheck, and targeted lint passed fresh during closure. The live `m066_s05_ok` gate did not run because `M066_S05_REPO`, `M066_S05_REVIEW_OUTPUT_KEY`, optional `M066_S05_DELIVERY_ID`, `GITHUB_APP_ID`, and GitHub App private key material are absent; that is recorded as a known limitation rather than accepted proof.

## Verification

Fresh closure verification ran `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts`; it completed successfully with 189 Bun tests passing, TypeScript exit 0, and ESLint exit 0. A direct environment preflight showed `M066_S05_REPO`, `M066_S05_REVIEW_OUTPUT_KEY`, `M066_S05_DELIVERY_ID`, `GITHUB_APP_ID`, and GitHub private key material unset, so the live verifier could not honestly be run. The smoke artifact grep check for `m066_s05_ok|PR URL|reviewOutputKey|formatter review|suggestion comment|verify:m066:s05|mention-format-suggestions` is satisfied, but the artifact is explicitly blocked and does not claim accepted live proof.

## Requirements Advanced

- R085 — Verifier and runbook now encode the required live proof contract, but accepted live proof is still blocked.
- R077 — Verifier rejects issue-comment-only and standalone surfaces and requires same-PR Pull Request Review evidence.
- R083 — Docs and smoke artifact expose skipped/capped/posted/publisher failure visibility fields.
- R080 — Fresh S04 regression suites passed during S05 closure.
- R084 — Fresh combined-mode regression suites passed during S05 closure.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

The slice plan expected an accepted live GitHub smoke proof. This environment had no captured live formatter-suggestion delivery bundle and no GitHub App/Azure operator credentials, and auto-mode disallowed interactive secret collection. S05 therefore delivered the verifier, docs, and blocked proof artifact, but did not validate R085 with `m066_s05_ok`.

## Known Limitations

Accepted live proof remains blocked. Downstream milestone closure must not treat R085/R077 live committability proof as validated until an authenticated operator run captures a real same-PR formatter Pull Request Review, associated fenced suggestion review comment, reviewOutputKey, delivery id/log correlation, and successful `m066_s05_ok` verifier JSON. The local GSD memory store also returned `database disk image is malformed`, so capture_thought could not persist decisions.

## Follow-ups

Run the documented smoke from an authenticated operator/deployed environment, update `docs/smoke/m066-formatter-suggestions.md` with real proof fields, rerun `bun run verify:m066:s05` to `m066_s05_ok`, and only then update R085/R077 validation status.

## Files Created/Modified

- `scripts/verify-m066-s05.ts` — Live formatter-suggestion verifier.
- `scripts/verify-m066-s05.test.ts` — Verifier argument, negative, and happy-path coverage.
- `package.json` — Added `verify:m066:s05` script.
- `docs/runbooks/formatter-suggestions.md` — Operator setup, trigger, verification, and troubleshooting runbook.
- `docs/configuration.md` — Formatter-suggestion config reference.
- `docs/smoke/m066-formatter-suggestions.md` — Durable proof template currently marked blocked due missing live proof inputs.
