---
id: S02
parent: M051
milestone: M051
provides:
  - A settled manual rereview contract for downstream work: `@kodiai review` is supported; `ai-review` / `aireview` rerequest is retired.
  - Validated R055 evidence that the repo no longer documents or accepts the unsupported UI-team trigger.
  - Stable positive and negative observability surfaces for future trigger audits and truthfulness cleanup.
requires:
  - slice: S01
    provides: D124/D125: proof that UI-team topology can exist while remaining unproven as a supported operator trigger, which justified removing the stale contract instead of documenting it.
affects:
  - S03
key_files:
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - src/execution/config.ts
  - src/execution/config.test.ts
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
  - docs/runbooks/review-requested-debug.md
  - docs/configuration.md
  - docs/smoke/phase75-live-ops-verification-closure.md
  - .kodiai.yml
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D125 — close R055 by removing the unsupported UI-team rereview contract instead of leaving a wired-but-unproven path in place.
  - D126 — prove the surviving manual rereview contract via explicit mention-review completion logs (`taskType=review.full`, `lane=interactive-review`) plus skipped team-only `review_requested` logs for retired `ai-review` / `aireview` requests.
  - Keep `pull_request.review_requested` documentation only as debug/automatic-review context, not as a supported operator rereview procedure.
patterns_established:
  - Retiring an unsupported trigger contract requires a coordinated sweep across runtime code, config schema/defaults/examples, regression tests, and operator docs/smoke artifacts — fixing only the main handler/runbook leaves stale truth surfaces behind.
  - The surviving manual rereview proof should come from explicit mention completion and publish evidence, not from reviewer-team topology or self-generated open-event requests.
  - Negative grep proofs on stale trigger strings can false-positive on unrelated `kodiai-reviewer` prose unless the pattern uses word boundaries or the wording avoids that substring trap.
observability_surfaces:
  - `Mention execution completed` logs for explicit review mentions now carry `lane=interactive-review` and `taskType=review.full`, giving operators a positive proof surface for the supported manual rereview path.
  - Team-only `pull_request.review_requested` deliveries for `ai-review` / `aireview` remain observable as skipped manual triggers with `skipReason=team-only-request`, giving a stable negative proof surface for the retired path.
  - Operator docs and the Phase 75 smoke doc now align on `@kodiai review` as the only supported manual rerun instruction.
drill_down_paths:
  - .gsd/milestones/M051/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M051/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M051/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-19T00:14:07.319Z
blocker_discovered: false
---

# S02: Manual rereview contract implementation

**Removed the unsupported `ai-review` / `aireview` rereview-team contract from runtime code, config, docs, and tests, leaving `@kodiai review` as the only documented and regression-tested manual rereview trigger.**

## What Happened

## Delivered
- Removed `review.uiRereviewTeam` and `review.requestUiRereviewTeamOnOpen` from the checked-in config example, runtime schema/defaults, and config tests.
- Simplified `createReviewHandler` so only direct Kodiai reviewer requests are accepted; team-only `pull_request.review_requested` deliveries, including `ai-review` / `aireview`, now skip cleanly instead of enqueueing review work.
- Deleted the now-unused rereview-team helper/runtime branch and its tests, including the open-time best-effort auto-request behavior.
- Rewrote the operator truth surface so `docs/runbooks/review-requested-debug.md`, `docs/configuration.md`, and `docs/smoke/phase75-live-ops-verification-closure.md` no longer advertise the retired UI-team trigger.
- Tightened the surviving manual-trigger proof surface so explicit `@kodiai review` runs are evidenced by mention-handler completion logs carrying `lane=interactive-review` and `taskType=review.full`, alongside the existing approval/fallback publish bridge.

## Why this matters
This slice closes the removal branch chosen in D125: operators no longer have repo config, runtime behavior, tests, or docs implying that an unproven UI-team rereview path is supported. `R055` can now validate on the truthful contract that remains: explicit PR-scoped `@kodiai review` mentions are supported, while team-only rerequest deliveries are observable only as skipped negatives.

## Operational Readiness
- **Health signal:** explicit manual rereview is now evidenced by `@kodiai review` tests plus structured mention completion logs showing `lane=interactive-review`, `taskType=review.full`, and the normal approval/fallback publish path.
- **Failure signal:** any `pull_request.review_requested` delivery that only names `ai-review` / `aireview` should surface as `skipReason=team-only-request`; any reappearance of removed keys or team strings in docs/config is contract drift.
- **Recovery procedure:** if operators need a manual rerun, use a PR-scoped `@kodiai review` mention. Reintroducing a team-based rereview path would require a new slice with fresh human-generated proof before docs or config are allowed to advertise it again.
- **Monitoring gaps:** this slice does not add new live human-trigger telemetry beyond the mention completion/publish logs; future truthfulness work can continue auditing those logs and doc/config drift but should not treat UI-team topology alone as proof.

## Verification

Fresh slice-level verification passed:
- `bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts` → 209 pass, 0 fail.
- `bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts` → 243 pass, 0 fail.
- `! rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview" docs/runbooks/review-requested-debug.md docs/configuration.md docs/smoke/phase75-live-ops-verification-closure.md .kodiai.yml && rg -n "@kodiai review" docs/runbooks/review-requested-debug.md docs/smoke/phase75-live-ops-verification-closure.md` → exit 0, proving stale UI-team trigger claims are gone while the surviving explicit mention trigger remains documented.
- `bun run tsc --noEmit` → exit 0.

## Requirements Advanced

None.

## Requirements Validated

- R055 — Removed `ai-review` / `aireview` support from runtime/config/docs/tests, kept `@kodiai review` as the only documented/tested manual rereview trigger, and passed fresh verification with the review/config tests, mention/review tests, docs grep sweep, and `bun run tsc --noEmit`.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

The retired UI-team rereview path is intentionally unsupported after this slice. Any future reintroduction would require fresh human-generated proof before docs, config, or tests can claim it works.

## Follow-ups

S03 can now focus on the remaining operator/verifier truthfulness debt from PR #87 without reopening rereview-path ambiguity.

## Files Created/Modified

- `src/handlers/review.ts` — Removed rereview-team acceptance/auto-request behavior and kept only direct-Kodiai reviewer handling plus team-only skip logging.
- `src/handlers/review.test.ts` — Locked the negative regressions for `ai-review` / `aireview` team-only `review_requested` events and kept direct reviewer behavior explicit.
- `src/execution/config.ts` — Removed deprecated rereview-team keys from the runtime config schema/defaults.
- `src/execution/config.test.ts` — Proved deprecated rereview-team keys are ignored instead of loaded back into config.
- `src/handlers/mention.ts` — Added lane/task-type completion-log evidence for explicit `@kodiai review` runs.
- `src/handlers/mention.test.ts` — Proved explicit `@kodiai review` stays on `interactive-review` / `review.full` and publishes through the supported review path.
- `docs/runbooks/review-requested-debug.md` — Removed stale UI-team trigger guidance and kept `pull_request.review_requested` content only as debug context.
- `docs/configuration.md` — Removed retired rereview-team config keys from the user-facing configuration reference.
- `docs/smoke/phase75-live-ops-verification-closure.md` — Stopped treating accepted rereview-team requests as valid smoke-closure evidence.
- `.kodiai.yml` — Stopped advertising the retired rereview-team settings in the checked-in repo example.
- `.gsd/KNOWLEDGE.md` — Recorded the grep false-positive gotcha and the surviving manual-trigger proof pattern for future agents.
- `src/handlers/rereview-team.ts` — Removed the now-dead rereview-team helper runtime file.
- `src/handlers/rereview-team.test.ts` — Removed the now-dead rereview-team helper test file.
