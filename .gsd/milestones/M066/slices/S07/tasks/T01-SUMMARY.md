---
id: T01
parent: S07
milestone: M066
key_files:
  - docs/smoke/m066-formatter-suggestions.md
  - .gsd/milestones/M066/slices/S06/tasks/T03-SUMMARY.md
  - .gsd/milestones/M066/slices/S06/tasks/T04-SUMMARY.md
  - src/handlers/mention.ts
  - src/handlers/formatter-suggestion-intent.ts
  - src/handlers/formatter-suggestion-orchestration.ts
  - src/handlers/mention.test.ts
key_decisions:
  - Treat the first failing boundary as formatter-intent routing/classification drift in the deployed mention handler, because current source would short-circuit format-only requests before generic mention execution.
duration: 
verification_result: mixed
completed_at: 2026-05-05T05:09:12.485Z
blocker_discovered: false
---

# T01: Root-caused the deployed formatter trigger miss to formatter-intent routing drift before the format-only subflow.

**Root-caused the deployed formatter trigger miss to formatter-intent routing drift before the format-only subflow.**

## What Happened

Reconstructed the PR #134 failure from the durable smoke artifact, S06 summaries, and current mention routing code/tests. The webhook event shape and PR surface were not the first failure: `docs/smoke/m066-formatter-suggestions.md` records a real PR issue-comment trigger (`@kodiai format suggestions`) on PR #134, a captured delivery id, `surface=pr_comment`, an eyes acknowledgement, and a successful ACA mention job. Config loading/publisher were also not the first observed failure: if current source detects format-only intent, `src/handlers/mention.ts:1976` enters the format-only branch, calls `runFormatterSuggestionForMention`, logs `Format-only formatter suggestion request completed` at `src/handlers/mention.ts:2005`, and returns before the generic executor path. Even a missing formatter command would post setup guidance without calling Claude, as covered by `src/handlers/mention.test.ts` around the setup-needed case. The deployed run instead emitted generic `Mention execution completed` evidence and a conversational issue-comment response, with no `formatterStatus`, `commandStatus`, `publisherStatus`, or formatter `reviewOutputKey`, so it fell through before the formatter subflow. Current source and tests show the intended boundary: `src/handlers/mention.ts:1754-1755` strips accepted handles and calls `detectFormatterSuggestionRequest(userQuestion)`, `src/handlers/formatter-suggestion-intent.ts` detects `format suggestions`, and `src/handlers/mention.test.ts` verifies `@kodiai format suggestions` bypasses Claude and calls the formatter subflow. Therefore the first failing boundary is deployed formatter-intent routing/classification availability, not GitHub acceptance, verifier logic, publisher mapping, or PR surface normalization. The next regression target should pin a PR issue-comment event with body `@kodiai format suggestions` and assert that it produces the format-only structured log/subflow and never reaches the generic conversational executor.

## Verification

Verified the smoke artifact and S06 summaries show a real PR comment trigger that was acknowledged and completed as a generic mention run but emitted no formatter subflow fields. Verified current source line evidence for mention normalization, formatter-intent detection, format-only short-circuit behavior, formatter reviewOutputKey generation, and the generic mention completion logger. Ran the targeted formatter mention tests; the current code passes the expected format-only and combined formatter-routing behavior, which supports deployed-revision/routing drift as the root-cause boundary. Memory query and memory capture both failed because the GSD memory database is malformed/unwritable; this limitation is recorded as a known issue.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `memory_query formatter suggestions mention routing` | 1 | ❌ fail | 0ms |
| 2 | `artifact/code inspection: read docs/smoke/m066-formatter-suggestions.md and S06 task summaries; rg line evidence for formatter routing and logs` | 0 | ✅ pass | 20000ms |
| 3 | `find .gsd/milestones/M066 -type f | sort | rg 'VALIDATION|VALIDATION.md|M066-VALIDATION'` | 1 | ❌ fail | 10000ms |
| 4 | `bun test ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts -t "formatter suggestion" --timeout 30000` | 0 | ✅ pass | 568ms |
| 5 | `capture_thought M066 formatter trigger routing gotcha` | 1 | ❌ fail | 0ms |

## Deviations

The plan referenced `.gsd/milestones/M066/M066-VALIDATION.md`, but no validation markdown file exists on disk under `.gsd/milestones/M066`; the smoke artifact and S06 summaries contained the needed evidence.

## Known Issues

The local GSD memory database is malformed/unwritable (`memory_query` failed and `capture_thought` failed). Accepted live formatter proof remains missing until a fixed deployment emits a formatter `mention-format-suggestions` reviewOutputKey and same-PR suggestion review.

## Files Created/Modified

- `docs/smoke/m066-formatter-suggestions.md`
- `.gsd/milestones/M066/slices/S06/tasks/T03-SUMMARY.md`
- `.gsd/milestones/M066/slices/S06/tasks/T04-SUMMARY.md`
- `src/handlers/mention.ts`
- `src/handlers/formatter-suggestion-intent.ts`
- `src/handlers/formatter-suggestion-orchestration.ts`
- `src/handlers/mention.test.ts`
