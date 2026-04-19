---
id: T01
parent: S02
milestone: M051
key_files:
  - src/execution/config.ts
  - src/execution/config.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - .kodiai.yml
  - src/handlers/rereview-team.ts
  - src/handlers/rereview-team.test.ts
key_decisions:
  - Remove the unsupported rereview-team trigger entirely instead of leaving a deprecated runtime path in place.
  - Keep negative regression coverage for `ai-review` / `aireview` as skipped team-only `review_requested` events rather than accepted triggers.
duration: 
verification_result: passed
completed_at: 2026-04-18T23:55:28.377Z
blocker_discovered: false
---

# T01: Removed the unsupported UI-team rereview config and handler path so only direct Kodiai rereview requests remain active.

**Removed the unsupported UI-team rereview config and handler path so only direct Kodiai rereview requests remain active.**

## What Happened

I executed the removal branch from D124 rather than leaving the wired-but-unproven rereview-team path in place. I started by flipping the contract tests red: config defaults now assert the removed rereview keys are absent, `pull_request.review_requested` events for `ai-review` and `aireview` now assert a clean skip instead of enqueueing review work, and open-event handling now asserts that no extra reviewers are auto-requested.

With the failing tests in place, I removed `review.uiRereviewTeam` and `review.requestUiRereviewTeamOnOpen` from `src/execution/config.ts` so they are no longer part of the repo config schema or defaults. In `src/handlers/review.ts`, I removed the rereview-team helper import, deleted the special-case acceptance path for `ai-review` / `aireview`, and simplified `review_requested` gating so only direct Kodiai reviewer requests are accepted while any team-only request logs a generic `team-only-request` skip. I also removed the open-time auto-request branch entirely, which eliminated the last runtime use of the rereview-team helper.

After the runtime branch was gone, I deleted `src/handlers/rereview-team.ts` and `src/handlers/rereview-team.test.ts` as dead code. I then cleaned the checked-in `.kodiai.yml` example so it no longer advertises the removed rereview-team settings, updated `src/handlers/review.test.ts` fixture config to stop carrying the deleted keys, and added a narrow `src/execution/config.test.ts` regression proving that deprecated rereview-team keys are ignored if they still appear in a repo config file. This keeps the surviving proof surface explicit: manual reviewer rerequests still work when Kodiai itself is requested, and team-only rerequests skip cleanly without misleading acceptance/request logs.

## Verification

I verified the removal with a direct source/config sweep and the task’s full test bundle. A targeted `rg` check over `src/handlers/review.ts`, `src/execution/config.ts`, and `.kodiai.yml` confirmed there are no remaining source/config references to `ai-review`, `aireview`, `uiRereviewTeam`, `requestUiRereviewTeamOnOpen`, or the deleted rereview-team helper symbols, and explicit file checks confirmed both `src/handlers/rereview-team.ts` and `src/handlers/rereview-team.test.ts` are gone. I then ran `bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts`; all 208 tests passed, including the new negative coverage for team-only `review_requested` events and the config regression proving deprecated rereview-team keys are stripped from the loaded config object.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `rg -n "\\b(ai-review|aireview)\\b|uiRereviewTeam|requestUiRereviewTeamOnOpen|Accepted review_requested event for rereview team|requestRereviewTeamBestEffort" src/handlers/review.ts src/execution/config.ts .kodiai.yml && test ! -e src/handlers/rereview-team.ts && test ! -e src/handlers/rereview-team.test.ts` | 0 | ✅ pass | 35ms |
| 2 | `bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts` | 0 | ✅ pass | 5061ms |

## Deviations

None.

## Known Issues

Operator-facing docs and smoke artifacts can still contain stale `ai-review` / `aireview` guidance until T02 updates those truth surfaces. This task intentionally limited itself to code, config, and tests.

## Files Created/Modified

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `.kodiai.yml`
- `src/handlers/rereview-team.ts`
- `src/handlers/rereview-team.test.ts`
