---
id: S02
parent: M066
milestone: M066
provides:
  - Formatter command runner result shape for S04 orchestration.
  - Parsed formatter hunk model with file path, old/new ranges, line cursors, and skip reasons.
  - Safe GitHub suggestion payload model for S03 batched same-PR publisher.
requires:
  []
affects:
  - S03
  - S04
  - S05
key_files:
  - src/execution/formatter-suggestions.ts
  - src/execution/formatter-suggestions.test.ts
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Unknown formatter-command brace placeholders remain literal; only `{baseRef}`, `{headRef}`, and `{diffRange}` are substituted.
  - Unsupported formatter diff file statuses are skipped at file granularity rather than partially parsed.
  - Formatter suggestions validate against the PR RIGHT-side line index before enforcing `maxSuggestions`, so caps only drop candidates that were otherwise safe and batchable.
patterns_established:
  - Side-effect-injected command runner seam for formatter execution and tests.
  - Conservative parser/model boundary: unsupported or malformed diff state becomes structured skip diagnostics.
  - Validation-before-capping mapper flow for truthful generated/skipped/capped counts.
observability_surfaces:
  - Formatter command result includes status, exitCode, timedOut, durationMs, resolvedCommand, stdout, and bounded/redacted stderrSummary.
  - Mapper result includes suggestions, skipped entries, counts, and capped boolean.
  - Skip entries include reason/detail/path/source metadata for downstream logs and PR-facing summaries.
drill_down_paths:
  - .gsd/milestones/M066/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M066/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M066/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-05-05T00:33:05.148Z
blocker_discovered: false
---

# S02: Formatter command and diff-to-suggestion mapper

**Implemented the formatter command runner, conservative unified-diff parser, PR RIGHT-side commentability index, and capped GitHub suggestion payload mapper for same-PR formatter suggestions.**

## What Happened

S02 delivered the pure execution/mapping contract that downstream S03/S04 can consume without touching GitHub state. The new `src/execution/formatter-suggestions.ts` module exposes a side-effect-injected formatter command runner with deterministic `no-command`, `no-op`, `success`, `failed`, and `timed-out` statuses; command resolution substitutes only `{baseRef}`, `{headRef}`, and `{diffRange}` while leaving unknown brace placeholders literal. It also bounds and redacts visible stderr summaries using the existing sanitizer path.

The slice added a conservative git unified-diff parser that models formatter files, hunks, and lines with old/current and new/formatted cursor positions. Binary files, added files, deleted files, renames, malformed file headers, and malformed hunk ranges are surfaced as structured skips rather than guessed. The parser preserves blank formatted lines and ignores `No newline at end of file` markers.

The mapper side added `buildPrDiffCommentabilityIndex()` and `mapFormatterDiffToSuggestions()`. The PR diff index records only RIGHT-side context/addition lines by path. The mapper extracts contiguous formatter replacement groups, requires every target old/current line to exist in the PR RIGHT-side index, skips pure insertions/deletions and unmappable ranges, and emits S03-ready payloads containing `path`, `line`, optional `startLine`, `side: "RIGHT"`, markdown suggestion blocks, raw `suggestionBody`, and source hunk metadata. `maxSuggestions` is enforced after safety validation, so dropped candidates are accurately reported as capped rather than unsafe.

Task-level memory capture was attempted for the three key decisions, but the memory tool failed to create entries, consistent with the task summaries' note that the GSD memory DB was malformed in this environment. The decisions are therefore recorded in this slice summary for downstream readers.

## Verification

Fresh slice-level verification passed after all code changes and before slice completion: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000` exited 0 with 269 passing tests, 0 failures, and 1246 expectations. This covers S01 regressions plus S02 formatter runner/parser/mapper fixtures. Task summaries also record targeted `formatter-suggestions.test.ts` passes after each task. Observability/diagnostic surfaces are fixture-proven through returned status fields, exit code, timeout flag, duration, bounded/redacted stderr summary, generated/skipped/capped counts, and per-skip reason/detail entries (`target-range-not-in-pr-diff`, `pure-insertion`, `pure-deletion`, `unsupported-file`, `malformed-diff`, `max-suggestions-exceeded`).

## Requirements Advanced

- R077 — Provided S03-ready same-PR suggestion payloads; actual GitHub publication and live committability proof remain downstream.
- R080 — Provided the formatter subflow contract that combined request orchestration can run independently beside normal review.
- R081 — Provided batchable inline suggestion payloads for a future single PR review publisher.
- R084 — Provided structured command statuses and skip diagnostics for visible formatter and combined-mode partial failure reporting.

## Requirements Validated

- R078 — M066/S02 slice regression command passed with 269 tests; command runner fixtures prove configured command execution, placeholder substitution, status shaping, and bounded diagnostics.
- R082 — M066/S02 formatter parser/mapper fixtures prove deterministic conversion from formatter unified diff to PR RIGHT-side GitHub suggestion payloads, with unsupported/unmappable hunks skipped.
- R083 — M066/S02 mapper fixtures prove `maxSuggestions` caps safe candidates and reports skipped/capped diagnostics with structured reasons/counts.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

None from the S02 implementation plan. Live GitHub publication remains intentionally out of scope for S03/S05.

## Known Limitations

S02 does not publish reviews or call GitHub. Pure insertions and pure deletions are intentionally skipped for this slice. Memory capture for key decisions failed because the memory store returned create errors; earlier task summaries observed `database disk image is malformed` for the GSD memory DB.

## Follow-ups

S03 should batch `mapFormatterDiffToSuggestions()` payloads into one same-PR review, convert `startLine` to GitHub's `start_line` field and include `start_side` as needed, add idempotency markers, and surface whole-batch rejection results. S04 should invoke this module from explicit and combined mention flows with bounded concurrency/timeout behavior. S05 should run the live smoke that proves GitHub accepts at least one suggestion.

## Files Created/Modified

- `src/execution/formatter-suggestions.ts` — New formatter command runner, diff parser, PR diff index builder, and suggestion mapper contracts.
- `src/execution/formatter-suggestions.test.ts` — Fixture tests for command statuses, parser skips/models, commentability indexing, safe mapping, unsafe skips, and cap behavior.
- `.gsd/REQUIREMENTS.md` — Rendered requirement status updates for R078, R082, and R083 after validation.
