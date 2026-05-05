---
id: S01
parent: M066
milestone: M066
provides:
  - Config shape: `review.formatterSuggestions.automatic`, optional `command`, and bounded `maxSuggestions`.
  - Mention intent contract for format-only and review-and-format formatter suggestions.
  - Executor-context handoff field: `formatterSuggestionRequest?: FormatterSuggestionRequest`.
requires:
  []
affects:
  - S02
  - S03
  - S04
  - S05
key_files:
  - src/execution/config.ts
  - src/execution/config.test.ts
  - src/handlers/formatter-suggestion-intent.ts
  - src/handlers/formatter-suggestion-intent.test.ts
  - src/execution/types.ts
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
  - .gsd/PROJECT.md
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Use `automatic` rather than an `enabled` flag so default-off automatic formatter suggestions do not block explicit formatter-suggestion requests.
  - Keep formatter-suggestion mention parsing in a pure handler-local module and pass its descriptor through `ExecutionContext` rather than re-parsing downstream.
  - Treat only `review-and-format` formatter requests as explicit review work so format-only suggestions stay read-only.
patterns_established:
  - `review.formatterSuggestions` is the config seam for later formatter execution and suggestion caps.
  - `src/handlers/formatter-suggestion-intent.ts` is the single parser for explicit formatter-suggestion mention intent.
  - `ExecutionContext.formatterSuggestionRequest` is the downstream handoff from mention routing into formatter execution/orchestration.
  - Combined formatter requests should preserve normal review routing while carrying formatter intent separately.
observability_surfaces:
  - No new runtime observability surface was added in S01. The proof surface is fixture-level executor-context assertions for formatter intent, writeMode, taskType, reviewOutputKey, and enableInlineTools. Later slices should add structured logs/result fields for formatter execution, skip reasons, publisher counts, and combined-mode partial failures.
drill_down_paths:
  - .gsd/milestones/M066/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M066/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M066/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-05-05T00:17:17.268Z
blocker_discovered: false
---

# S01: Formatter suggestion config and mention intent

**Established the default-off formatter-suggestion config and explicit mention-intent contract for format-only and combined review+format requests.**

## What Happened

S01 delivered the contract layer for same-PR formatter suggestions without executing formatters or publishing GitHub suggestions. The repo config now has `review.formatterSuggestions` with `automatic: false` by default, optional `command`, and bounded `maxSuggestions` semantics, preserving the requirement that explicit formatter requests remain allowed even when automatic mode is off. A pure parser module, `src/handlers/formatter-suggestion-intent.ts`, recognizes conservative suggestion-oriented phrases such as `format suggestions`, `formatting suggestions`, `suggest formatting fixes`, and `suggest formatting changes`, plus combined phrases such as `review & format suggestions`, `review and format suggestions`, `review + format suggestions`, and `review with format suggestions`. The descriptor is serializable (`requested: true`, `mode`, `source: "explicit-mention"`, `normalizedRequest`) and is passed through `ExecutionContext.formatterSuggestionRequest` from the real mention handler. Mention routing preserves existing review behavior for combined requests, keeps format-only requests read-only, and prevents suggestion wording from being misclassified as write mode. This slice intentionally stops at config + routing: S02 owns formatter command execution and diff-to-suggestion mapping, S03 owns batched GitHub review publication, and S04 owns full explicit/combined orchestration.

## Verification

Fresh final slice verification passed after the last file change: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000` completed with 245 pass, 0 fail, 1172 expect() calls across 3 files. The suite proves config defaults/parsing, pure formatter-suggestion phrase detection, conservative non-detection of broad write-like commands such as `format this PR`, and full mention-handler fixture behavior for `@kodiai format suggestions`, `@kodiai suggest formatting fixes`, and `@kodiai review & format suggestions`.

## Requirements Advanced

- R078 — Added config shape with optional formatter `command`; command execution and adapter seam remain S02.
- R080 — Added combined mention intent descriptor and review-preserving mention routing; independent subflow orchestration remains S04.

## Requirements Validated

- R076 — Final S01 test command passed with 245 pass, 0 fail and includes parser/full-handler tests for `@kodiai format suggestions` and `@kodiai suggest formatting fixes`.
- R079 — Final S01 test command passed with config tests for `automatic: false` defaults and mention tests proving explicit requests remain available with automatic mode off.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

The slice did not implement formatter command execution, diff mapping, GitHub suggestion publishing, or combined subflow orchestration; those are explicitly assigned to S02-S04. LSP diagnostics were attempted by task executors but unavailable because no TypeScript language server was active in the harness. Memory capture attempts during closure failed because the local GSD memory store returned `failed to create memory`.

## Known Limitations

No formatter command is run yet and no GitHub suggestion is published yet. Format-only requests currently only carry a descriptor into executor context for later slices. Missing formatter command behavior remains downstream orchestration work. The local GSD memory store appears unhealthy, so durable memory capture could not be recorded from this closer.

## Follow-ups

S02 should consume `review.formatterSuggestions.command` and `maxSuggestions` plus `ExecutionContext.formatterSuggestionRequest` to run the configured formatter and map unified diffs into safe suggestion payloads. S03 should publish those payloads as one same-PR review with inline suggestion blocks and idempotency markers. S04 should orchestrate format-only and combined review+format requests with independent failure handling.

## Files Created/Modified

- `src/execution/config.ts` — Added `review.formatterSuggestions` schema/defaults.
- `src/execution/config.test.ts` — Added config tests for defaults, configured parsing, bounds, and fallback behavior.
- `src/handlers/formatter-suggestion-intent.ts` — Added pure formatter-suggestion mention parser and descriptor type.
- `src/handlers/formatter-suggestion-intent.test.ts` — Added parser coverage for format-only, combined, polite, and non-suggestion phrases.
- `src/execution/types.ts` — Extended `ExecutionContext` with optional `formatterSuggestionRequest`.
- `src/handlers/mention.ts` — Wired formatter-suggestion intent into queue/execution routing and PR write-intent guard.
- `src/handlers/mention.test.ts` — Added full mention-handler fixture tests for format-only and combined formatter-suggestion requests.
- `.gsd/PROJECT.md` — Refreshed current project state with M066/S01 contract and downstream seams.
