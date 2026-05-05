---
id: S04
parent: M066
milestone: M066
provides:
  - End-to-end explicit format-only orchestration for S05 live smoke testing.
  - End-to-end combined review+formatter orchestration with independent failure handling.
  - A formatter-specific review-output key/idempotency contract for live smoke correlation.
  - Structured logs and visible diagnostics for operator troubleshooting.
requires:
  - slice: S01
    provides: Formatter suggestion config defaults and explicit mention intent modes.
  - slice: S02
    provides: Formatter command runner, PR diff commentability index, and safe suggestion mapper.
  - slice: S03
    provides: Batched same-PR formatter suggestion Pull Request Review publisher and idempotency contract.
affects:
  - S05
key_files:
  - src/handlers/formatter-suggestion-orchestration.ts
  - src/handlers/formatter-suggestion-orchestration.test.ts
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
  - src/execution/formatter-suggestions.ts
  - src/execution/formatter-suggestion-publisher.ts
  - .gsd/PROJECT.md
key_decisions:
  - Used `mention-format-suggestions` as the formatter-specific review-output action so formatter reviews do not collide with normal `mention-review` idempotency.
  - Returned structured expected-failure results for formatter command, PR diff, mapping, and publisher outcomes instead of throwing for normal runtime failures.
  - Format-only formatter mentions short-circuit after checkout/config load and before prompt/executor construction so they stay read-only and avoid Claude cost.
  - Combined review-and-format runs Claude review first and formatter suggestions afterward so formatter workspace mutations cannot affect review context.
  - Formatter visible diagnostics in combined mode bypass normal review publish-rights checks because formatter publication has its own S03 idempotency and failure reporting surface.
patterns_established:
  - Use a focused orchestration helper with injected side effects for explicit formatter suggestions, keeping the already-large mention handler from duplicating S02/S03 logic.
  - Represent formatter subflow outcomes as structured statuses with bounded visible messages rather than collapsing all failures into exceptions.
  - Use separate review-output key namespaces for normal review publication and formatter-suggestion publication.
  - Treat combined mode as two independent subflows with explicit partial-failure logging instead of one all-or-nothing operation.
observability_surfaces:
  - Format-only completion logs include formatter request/mode/status, command status, publisher status, suggestion/skipped/capped counts, and visible-reply result.
  - Combined completion logs include review conclusion/publication fields plus independent formatter status/count fields and combined partial-failure state.
  - Visible diagnostics cover setup-needed, no-op, command failure/timeout, PR diff unavailable, mapped no-suggestions, duplicate/idempotency skip, blocked publication, and publisher failure/rejection.
  - Formatter stdout and unbounded stderr are excluded from logs/comments; bounded/redacted summaries are used.
drill_down_paths:
  - .gsd/milestones/M066/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M066/slices/S04/tasks/T02-SUMMARY.md
  - .gsd/milestones/M066/slices/S04/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-05-05T01:22:02.379Z
blocker_discovered: false
---

# S04: Explicit and combined request orchestration

**S04 wired explicit formatter-suggestion mentions into the real PR mention handler: format-only requests bypass Claude and combined review+format requests run normal review plus formatter suggestions as independently reported subflows.**

## What Happened

## Delivered Behavior

S04 introduced a dedicated runtime composition seam, `runFormatterSuggestionSubflow()`, and wired it into `src/handlers/mention.ts` for both explicit formatter request modes.

- `@kodiai format suggestions` and equivalent format-only PR mentions now short-circuit after workspace checkout and repo config load, remain read-only, do not build a Claude prompt, and do not call `executor.execute`.
- Format-only requests invoke the formatter suggestion subflow with PR identity, workspace/ref/config data, installation/delivery metadata, bot handles, Octokit, workspace token, and GitHub PR-file fallback providers.
- `@kodiai review & format suggestions` preserves the existing explicit-review path (`review.full`/review routing, inline tools, review output keys, approval/fallback behavior) and then runs formatter suggestions afterward so formatter workspace mutations cannot affect the review context.
- Combined mode keeps subflows independent: executor error results still attempt formatter suggestions; executor thrown errors after setup attempt formatter suggestions before preserving the outer review error behavior; formatter failures or diagnostics do not suppress normal review fallback/publication.
- Formatter publication continues to use the S03 `publishFormatterSuggestionReview()` batched Pull Request Review publisher with a formatter-specific `mention-format-suggestions` review-output action and resolved PR head SHA. No branch pushes, bot commits, standalone suggestion comment loops, or new PRs were introduced.

## Orchestration Helper

`src/handlers/formatter-suggestion-orchestration.ts` centralizes the S04 formatter subflow. It composes the S02/S03 contracts instead of duplicating them: `runFormatterCommand()`, full PR diff collection, `buildPrDiffCommentabilityIndex()`, `mapFormatterDiffToSuggestions()`, head commit resolution, review-output key creation, and `publishFormatterSuggestionReview()`.

Expected subflow failures return structured statuses rather than throwing: `setup-needed`, `no-op`, `pr-diff-unavailable`, `mapped-no-suggestions`, `posted`, `duplicate`, `blocked`, and `failed`. Result fields include command/publisher status, suggestion/skipped/capped counts, review URL/id where available, bounded reason strings, and a `visibleMessage` only when the PR thread needs setup/no-op/failure/skip diagnostics.

## Visible Diagnostics and Redaction

Visible diagnostics cover missing formatter command setup, no-op formatter output, command failure/timeout, unavailable PR diff, mapped no-suggestions with skip summaries, duplicate/idempotency skip, blocked publication, and publisher/GitHub rejection. Tests assert raw formatter stdout is not logged or rendered, and bounded/redacted stderr or publisher rejection summaries are used instead.

Format-only publisher success relies on the formatter Pull Request Review as the visible success surface, avoiding an extra noisy issue comment. Combined-mode formatter diagnostics bypass normal review publish-rights gates because the S03 formatter publisher owns formatter idempotency and publication safety.

## Operational Readiness

- Health signal: structured completion logs for format-only and combined paths include formatter request/mode/status, command status, publisher status, suggestion/skipped/capped counts, visible-reply result, and review-side conclusion/publication fields where relevant.
- Failure signal: helper and handler tests cover command failure/timeout, PR diff unavailable, mapped no-suggestions, duplicate/idempotency skip, blocked secret-like content, publisher failure/rejection, executor error results, executor throws, and formatter failure alongside review fallback.
- Recovery procedure: operators can read the bounded visible diagnostic and structured logs to decide whether to configure `review.formatterSuggestions.command`, inspect formatter command failures, retry after GitHub/publisher rejection, or proceed with normal review results when only formatter failed.
- Monitoring gaps: S04 is fixture/integration-test proof only; S05 must still run a deployed/live GitHub smoke to prove GitHub accepts at least one generated suggestion as a committable same-PR suggestion.

## Downstream Notes for S05

S05 can consume the real explicit mention entrypoints. It should configure a formatter command that emits a git unified diff, trigger `@kodiai format suggestions` or `@kodiai review & format suggestions` on a test PR with a formatter-changeable line, and verify GitHub renders at least one Kodiai-generated suggestion as committable. S05 should use the structured log fields and formatter review output marker (`mention-format-suggestions`) to correlate the live run without relying on standalone comment success.

## Verification

Fresh S04 slice verification passed after task implementation and before slice completion.

- `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` passed: 182 pass, 0 fail, 982 assertions across 4 files.
- `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000` passed: 293 pass, 0 fail, 1350 assertions across 6 files.
- `bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/mention.test.ts src/handlers/formatter-suggestion-orchestration.ts src/handlers/formatter-suggestion-orchestration.test.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts` exited 0 with no output.

The regression suite covers the slice must-haves: format-only requests bypass Claude, combined requests call both review and formatter subflows, normal review failures do not suppress formatter attempts when setup is available, formatter diagnostics do not suppress normal review fallback, formatter publication uses the S03 batched publisher/idempotency path, unsafe/excessive suggestions remain capped/skipped by S02/S03 contracts, and raw formatter stdout/unbounded stderr are not surfaced.

## Requirements Advanced

- R077 — S04 preserves the same-PR Pull Request Review publisher path for formatter suggestions; S05 still must provide live GitHub committability proof.
- R081 — S04 consumes the S03 batched Pull Request Review publisher without introducing standalone comment loops or alternate publication paths.
- R082 — S04 consumes the S02 command/PR-diff/commentability mapper pipeline through the orchestration helper.
- R083 — S04 carries S02/S03 skipped/capped counts through formatter subflow results, logs, and visible diagnostics.

## Requirements Validated

- R080 — M066/S04 combined-mode tests and fresh full regression verification prove `@kodiai review & format suggestions` invokes normal review and formatter suggestions from one mention with independent failure handling.
- R084 — M066/S04 orchestration and mention-handler tests prove formatter failures and combined-mode partial failures are visible and do not block independently successful subflows.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

No plan-invalidating deviations. T03 added a shared mention-level formatter helper to avoid duplicating setup between format-only and combined paths while preserving the T02 format-only short-circuit. Memory capture attempts failed because the local GSD memory store reported memory creation failures.

## Known Limitations

S04 does not provide live GitHub committability proof; S05 remains responsible for deployed smoke verification that GitHub accepts at least one Kodiai-generated formatter suggestion. The GSD memory store was unhealthy during closure, so durable memory capture calls failed.

## Follow-ups

S05 should deploy or run against a real/test PR, trigger the explicit formatter suggestion flow, capture the formatter review URL/id and GitHub acceptance evidence, and write operator docs for configuring `review.formatterSuggestions.command`, `automatic`, and `maxSuggestions`.

## Files Created/Modified

- `src/handlers/formatter-suggestion-orchestration.ts` — New formatter suggestion subflow helper with injected command/diff/publisher/commit dependencies, structured statuses, visible diagnostics, and redaction-safe logging fields.
- `src/handlers/formatter-suggestion-orchestration.test.ts` — Tests for setup-needed, no-op, command failure/timeout, PR diff unavailable, mapped no-suggestions, posted, duplicate, blocked, failed/rejected, capped counts, and stdout redaction.
- `src/handlers/mention.ts` — Wired format-only and combined formatter suggestion request modes into the PR mention handler with independent review/formatter subflow handling.
- `src/handlers/mention.test.ts` — Regression tests proving format-only bypasses Claude and combined mode runs review plus formatter independently across success and failure cases.
- `.gsd/PROJECT.md` — Refreshed project state with M066/S04 completion context and formatter orchestration patterns.
