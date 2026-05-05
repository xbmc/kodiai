---
id: T03
parent: S06
milestone: M066
key_files:
  - docs/smoke/m066-formatter-suggestions.md
key_decisions:
  - Treat the missing formatter `mention-format-suggestions` reviewOutputKey after a real deployed trigger as a plan-invalidating blocker for downstream verify-only tasks rather than accepted proof.
  - Do not use the observed non-formatter `action-opened` reviewOutputKey as M066/S05 evidence.
duration: 
verification_result: mixed
completed_at: 2026-05-05T03:22:25.813Z
blocker_discovered: true
---

# T03: Triggered PR #134 formatter smoke and captured a deployed bounded decline instead of accepted formatter proof.

**Triggered PR #134 formatter smoke and captured a deployed bounded decline instead of accepted formatter proof.**

## What Happened

Posted the explicit `@kodiai format suggestions` trigger on controlled PR #134 using the authenticated `gh` operator path established by T02. GitHub accepted the trigger comment and Kodiai acknowledged it with an eyes reaction. Azure Container Apps logs correlated the trigger to delivery `9961ce70-4830-11f1-86fa-c01e4dffd5b0`, revision `ca-kodiai--deploy-20260504-081420`, and ACA job execution `caj-kodiai-agent-3dzowdd`, which completed successfully. However, the deployed mention path published a generic PR issue-comment response asking for more context instead of entering the formatter-suggestion subflow. No formatter `reviewOutputKey` containing `mention-format-suggestions`, formatter status fields, same-PR formatter Pull Request Review, or fenced suggestion comment was produced. Updated `docs/smoke/m066-formatter-suggestions.md` with this non-secret bounded decline and explicitly preserved accepted proof as pending. This invalidates the remaining verify-only task sequence until the deployed trigger classification/runtime path is fixed.

## Verification

Verified the artifact contains the required T03 non-secret trigger, delivery, PR, revision, job, and bounded-decline fields; verified GitHub shows the Kodiai eyes reaction and bounded Kodiai decline comment; verified GitHub has zero formatter marker reviews and zero fenced suggestion comments; verified Log Analytics has delivery/revision correlation and one mention completion row but zero formatter subflow rows; verified the observed non-formatter `action-opened` reviewOutputKey is rejected by `verify:m066:s05` with `m066_s05_invalid_arg`. The task-level verification is mixed because the live trigger and bounded failure evidence were captured, but the required formatter `reviewOutputKey` was not produced.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `memory_query formatter suggestions smoke docs/runbooks/formatter-suggestions gh` | 1 | ❌ fail | 0ms |
| 2 | `gh auth/repo/PR pre-trigger checks and PR surface read for xbmc/kodiai#134` | 0 | ✅ pass | 60000ms |
| 3 | `gh api repos/xbmc/kodiai/issues/134/comments -X POST -f body='@kodiai format suggestions'` | 0 | ✅ pass | 60000ms |
| 4 | `poll GitHub issue comments/reviews/review comments for Kodiai response, formatter marker, and suggestion fences` | 0 | ✅ pass | 280000ms |
| 5 | `az containerapp/log analytics correlation for delivery 9961ce70-4830-11f1-86fa-c01e4dffd5b0 and job caj-kodiai-agent-3dzowdd` | 0 | ✅ pass | 120000ms |
| 6 | `artifact required-field check plus GitHub surface checks for eyes reaction, bounded decline, zero formatter reviews, zero suggestion comments` | 0 | ✅ pass | 120000ms |
| 7 | `bun run verify:m066:s05 with observed non-formatter action-opened reviewOutputKey --json` | 1 | ❌ fail | 120000ms |
| 8 | `capture_thought M066 formatter trigger gotcha` | 1 | ❌ fail | 0ms |
| 9 | `final artifact field check and Log Analytics aggregate deliveryRows/revisionRows/mentionCompleted/formatterRows` | 0 | ✅ pass | 120000ms |

## Deviations

The task expected a formatter-specific `reviewOutputKey`; live execution produced a bounded decline instead. I updated the smoke artifact with failure evidence rather than fabricating accepted proof or running the verifier against the wrong key.

## Known Issues

The deployed app acknowledged `@kodiai format suggestions` but treated it as a generic formatting question and did not run the formatter-suggestion subflow. The local GSD memory store is malformed/unwritable, so memory query and capture_thought both failed. PR #134 also received unrelated Copilot review comments and a non-formatter Kodiai `action-opened` issue-comment marker; these are explicitly documented as not accepted M066/S05 proof.

## Files Created/Modified

- `docs/smoke/m066-formatter-suggestions.md`
