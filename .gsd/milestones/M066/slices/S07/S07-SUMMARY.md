---
id: S07
parent: M066
milestone: M066
provides:
  - Accepted live same-PR formatter suggestion proof for M066.
  - Validated R077 and R085 evidence.
  - A deployed routing/observability fix for explicit formatter mentions.
  - Regression coverage for PR issue-comment formatter trigger completion identity.
requires:
  []
affects:
  - M066 milestone validation
  - Future automatic formatter suggestion rollout
  - Future deployed smoke/runbook workflows
key_files:
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
  - docs/smoke/m066-formatter-suggestions.md
  - scripts/verify-m066-s05.ts
  - scripts/verify-m066-s05.test.ts
  - .gsd/REQUIREMENTS.md
  - .gsd/PROJECT.md
key_decisions:
  - Treat the first failing boundary as deployed formatter-intent routing/observability drift before the formatter subflow, not GitHub acceptance or formatter mapping.
  - Pin the deterministic regression at missing formatter completion evidence (`deliveryId`, `reviewOutputKey`, `reviewOutputAction`) rather than duplicating an already passing plain-trigger classification test.
  - Use a shared `mention-format-suggestions` action identity from mention routing through formatter subflow key/log generation.
  - Retry the documented idempotent ACA deploy after a transient Azure CLI connection reset instead of marking deployment unavailable.
  - Reuse controlled PR #134 for live proof because it remained open, mergeable, and carried the needed PR-head formatter command.
patterns_established:
  - Formatter live proof requires a formatter `mention-format-suggestions` reviewOutputKey plus a same-PR COMMENTED Pull Request Review with an associated fenced suggestion comment.
  - Format-only formatter suggestion handling remains read-only and bypasses Claude; combined review-and-format keeps normal review and formatter subflow failures independent.
  - Bounded deployed-smoke diagnostics should identify trigger classification, formatter command, mapper, publisher, GitHub acceptance, delivery id, and reviewOutputKey separately.
observability_surfaces:
  - `Format-only formatter suggestion request completed` now logs delivery/review-output identity and formatter status fields.
  - `Formatter suggestion subflow completed` logs command/publisher/suggestion counts and review id/url.
  - `docs/smoke/m066-formatter-suggestions.md` records active ACA revision, health/readiness, delivery id, reviewOutputKey, GitHub review/comment ids, verifier JSON, and bounded Log Analytics rows.
  - `verify:m066:s05` provides a stable `m066_s05_ok` proof gate and named bounded failure statuses.
drill_down_paths:
  - .gsd/milestones/M066/slices/S07/tasks/T01-SUMMARY.md
  - .gsd/milestones/M066/slices/S07/tasks/T02-SUMMARY.md
  - .gsd/milestones/M066/slices/S07/tasks/T03-SUMMARY.md
  - .gsd/milestones/M066/slices/S07/tasks/T04-SUMMARY.md
  - .gsd/milestones/M066/slices/S07/tasks/T05-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-05-05T05:37:20.933Z
blocker_discovered: false
---

# S07: Remediate deployed formatter-suggestion mention path and live proof

**S07 remediated the deployed formatter-suggestion mention proof path and captured accepted same-PR GitHub formatter suggestion evidence with `verify:m066:s05` returning `m066_s05_ok`.**

## What Happened

S07 started from the failed PR #134 smoke evidence and established that the webhook surface, PR issue-comment shape, PR-head config loading, formatter mapper, publisher, and verifier were not the first failing boundary. The deployed app had acknowledged `@kodiai format suggestions` but completed it as a generic conversational mention with no formatter subflow fields, no `mention-format-suggestions` reviewOutputKey, no same-PR Pull Request Review, and no fenced suggestion comment. Current source would already detect the phrase and short-circuit format-only requests before Claude/generic mention execution, so the slice treated the first actionable boundary as deployed formatter-intent routing/observability drift before the format-only subflow.

The remediation pinned that boundary with a deterministic PR issue-comment regression in `src/handlers/mention.test.ts`: body `@kodiai format suggestions`, PR context, PR-head formatter config, live delivery id propagation, Claude bypass, formatter subflow dispatch, and structured completion evidence containing `deliveryId`, `reviewOutputKey`, and `reviewOutputAction`. The source fix kept behavior narrow by introducing a shared `mention-format-suggestions` formatter review-output action in `src/handlers/mention.ts`, passing that identity into the formatter subflow, and logging the same delivery/review-output identity on both format-only and combined review-and-format completion. It did not change publisher semantics, write-mode safety, command execution, suggestion mapping, or Claude routing invariants.

The fix was deployed through the documented Azure Container Apps path. The first deploy hit a transient Azure CLI connection reset while updating ACA job secret references; the idempotent deploy was retried and produced active revision `ca-kodiai--deploy-20260504-222417`. `/healthz` returned HTTP 200 with `{"status":"ok","db":"connected"}` and `/readiness` returned HTTP 200 with `{"status":"ready"}`. A fresh authenticated operator trigger on `xbmc/kodiai#134` then produced delivery `462ed8c0-4843-11f1-8135-1c6010084b2c`, formatter reviewOutputKey `kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4`, same-PR COMMENTED Pull Request Review `4225484818`, and fenced suggestion review comment `3186219778` on `README.md` line 3. Bounded ACA logs for the same delivery/reviewOutputKey show `formatterStatus=posted`, `commandStatus=success`, `publisherStatus=posted`, `suggestions=1`, `skipped=0`, `capped=0`, `posted=1`, and `publisherSkipped=0`.

Downstream slices should treat `docs/smoke/m066-formatter-suggestions.md` as the durable live proof artifact for M066 S05/S07. The important pattern is that live formatter proof requires the formatter action key and same-PR Pull Request Review surface, not a generic mention response or issue comment. The PR-head formatter config gotcha remains relevant for future smokes when `main` lacks `review.formatterSuggestions.command`. The local GSD memory store remained malformed/unwritable during closure, so reusable decisions/gotchas were attempted via `capture_thought` but could not be persisted there; the slice summary and PROJECT.md preserve those lessons instead.

## Verification

Fresh slice-close verification ran after the last code changes. `bun run verify:m066:s05 -- --repo xbmc/kodiai --review-output-key "kodiai-review-output:v1:inst-109141824:xbmc/kodiai:pr-134:action-mention-format-suggestions:delivery-462ed8c0-4843-11f1-8135-1c6010084b2c:head-df017da6b6959038a288f8eae070b7a384ef0fa4" --delivery-id "462ed8c0-4843-11f1-8135-1c6010084b2c" --json` exited 0 and returned `success: true`, `status_code: "m066_s05_ok"`, review `4225484818`, and suggestion comment `3186219778`. The deterministic regression bundle also exited 0: `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000` reported 190 pass / 0 fail; `bunx tsc --noEmit --pretty false` exited 0; and targeted `bunx eslint` for the formatter/mention/verifier files exited 0. Documentation/operational evidence was checked with `rg` against `docs/smoke/m066-formatter-suggestions.md` and `.gsd/PROJECT.md`, confirming accepted status, active revision, `/healthz` and `/readiness` proof, structured formatter status fields, reviewOutputKey, delivery id, and `m066_s05_ok` markers.

## Requirements Advanced

- R077 — Provided the required same-PR committable GitHub suggestion proof surface.
- R085 — Provided live authenticated GitHub smoke proof accepted by the verifier.

## Requirements Validated

- R077 — M066/S07/T05 live smoke proof on xbmc/kodiai PR #134 posted same-PR Pull Request Review 4225484818 with fenced suggestion comment 3186219778, and `verify:m066:s05` returned `m066_s05_ok`.
- R085 — M066/S07/T05 accepted GitHub smoke captured trigger comment 4376745698, delivery 462ed8c0-4843-11f1-8135-1c6010084b2c, formatter `mention-format-suggestions` reviewOutputKey, COMMENTED review 4225484818, fenced suggestion comment 3186219778, formatterStatus=posted logs, and verifier status `m066_s05_ok`.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

None from the S07 slice contract. T02 adjusted the regression target from pure classification to the discovered missing formatter completion evidence boundary because current source already routed the plain trigger while the deployed smoke lacked the formatter subflow identity needed to distinguish it from generic mention handling.

## Known Limitations

The local GSD memory store is malformed/unwritable in this checkout: `memory_query` and `capture_thought` calls failed with database errors during the tasks and slice closeout. The accepted live proof does not enable automatic formatter suggestions; automatic inclusion remains explicitly default-off and reserved for future repo-config rollout.

## Follow-ups

Future automatic-mode work should reuse the same proof gate but must add its own deployed smoke for automatic inclusion. Future smokes should preserve PR-head formatter config setup when `main` intentionally lacks `review.formatterSuggestions.command`.

## Files Created/Modified

- `src/handlers/mention.ts` — Added shared formatter action identity and completion log fields for format-only and combined formatter mention paths.
- `src/handlers/mention.test.ts` — Added PR issue-comment regression for live formatter trigger completion evidence.
- `docs/smoke/m066-formatter-suggestions.md` — Updated from bounded decline to accepted live proof with deployed revision, GitHub review/comment ids, logs, and verifier JSON.
- `.gsd/REQUIREMENTS.md` — Regenerated by GSD requirement updates validating R077 and R085.
- `.gsd/PROJECT.md` — Refreshed current project state to reflect S07 accepted proof and validated requirements.
