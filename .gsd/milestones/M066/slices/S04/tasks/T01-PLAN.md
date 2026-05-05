---
estimated_steps: 5
estimated_files: 6
skills_used:
  - using-superpowers
  - test-driven-development
  - observability
  - verify-before-complete
---

# T01: Build formatter suggestion subflow helper with visible result rendering

Executor skills expected in task plan frontmatter: `using-superpowers`, `test-driven-development`, `observability`, `verify-before-complete`.

Why: The mention handler is already large; S04 needs a focused orchestration seam that composes the S02 formatter command/mapper and S03 publisher without burying failure handling in `src/handlers/mention.ts`. This task creates that helper and proves the boundary with injected tests before any handler wiring.

Steps:
1. Create `src/handlers/formatter-suggestion-orchestration.ts` exporting a `runFormatterSuggestionSubflow()` function, result/status types, and a visible-message renderer. Keep the default implementation side-effect-injected: formatter command runner, PR diff collector (defaulting to `collectDiffContext`), publisher (defaulting to `publishFormatterSuggestionReview`), commit resolver (defaulting to `git -C <workspaceDir> rev-parse HEAD` through Bun `$`), and optional logger.
2. The helper must accept repo/PR identity, `workspaceDir`, `baseRef`, `headRef`, `diffRange` input if already known, `review.formatterSuggestions.command`, `maxSuggestions`, installation/delivery data for a formatter-specific review output key, bot handles, Octokit, token, and fallback PR-file provider. It must collect full PR diff content for `buildPrDiffCommentabilityIndex()` and return a structured `FormatterSuggestionSubflowResult` instead of throwing for expected subflow failures.
3. Map S02/S03 outcomes into stable statuses such as `setup-needed`, `no-op`, `pr-diff-unavailable`, `mapped-no-suggestions`, `posted`, `duplicate`, `blocked`, and `failed`; include `commandStatus`, `publisherStatus`, `suggestions`, `skipped`, `capped`, `reviewUrl`, bounded `reason`, and `visibleMessage` when the user needs to see a setup/no-op/failure/skip diagnostic.
4. Add `src/handlers/formatter-suggestion-orchestration.test.ts` with fake dependencies proving no-command setup guidance, command no-op, command failed/timed-out, missing PR diff, mapper no-suggestions with skip summary, publisher posted, publisher skipped duplicate, publisher blocked, and publisher failed/rejected. Include a negative assertion that raw formatter stdout is not logged or included in visible diagnostics.
5. Run the targeted helper test and fix until it passes.

Must-haves:
- The helper uses `runFormatterCommand()`, `buildPrDiffCommentabilityIndex()`, `mapFormatterDiffToSuggestions()`, and `publishFormatterSuggestionReview()` rather than duplicating S02/S03 logic.
- It uses a formatter-specific review output key action (for example `mention-format-suggestions`) and the resolved PR head commit SHA, not the normal `mention-review` key.
- Expected subflow failures are returned as structured results with bounded visible messages; only unexpected programming errors may throw.
- Logs are structured decision/result logs and never contain formatter stdout or unbounded stderr.

Failure Modes (Q5):
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| Formatter command | Return `failed` with `commandStatus: failed` and bounded `stderrSummary`; do not publish | Return `failed` with `commandStatus: timed-out` and timeout wording | Treat empty stdout as `no-op`; malformed diff becomes mapper skips/no suggestions |
| PR diff collector | Return `failed`/`pr-diff-unavailable` with visible message | Return `failed`/`pr-diff-unavailable` with visible message | Missing `diffContent` returns `pr-diff-unavailable`; malformed diff yields no commentability and no unsafe publish |
| Publisher | Return `blocked`, `duplicate`, or `failed` using S03 status fields | Return `failed` using bounded error message if publisher dependency times out/throws | Return `failed` when publisher status cannot be mapped truthfully |

Load Profile (Q6):
- Shared resources: one formatter child process and one GitHub Pull Request Review publication attempt per explicit formatter request.
- Per-operation cost: one full PR diff collection, one formatter command, one diff mapping pass, and at most one `pulls.createReview` call.
- 10x breakpoint: formatter process runtime and GitHub review rate limits; the helper should preserve S02 timeout/cap semantics and S03 batch behavior.

Negative Tests (Q7):
- Malformed inputs: undefined command, empty formatter stdout, missing PR diff content, malformed formatter diff.
- Error paths: command failure, command timeout, publisher blocked, publisher failed/GitHub rejection.
- Boundary conditions: zero mapped suggestions, capped suggestions, duplicate/idempotency skip.

## Inputs

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestion-publisher.ts`
- `src/handlers/review.ts`
- `src/handlers/review-idempotency.ts`
- `src/execution/config.ts`

## Expected Output

- `src/handlers/formatter-suggestion-orchestration.ts`
- `src/handlers/formatter-suggestion-orchestration.test.ts`

## Verification

bun test ./src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000

## Observability Impact

Adds the formatter subflow result contract and structured log fields that future agents can inspect: request mode, run/skip reason, command status, mapper counts, publisher status, posted/skipped/capped counts, review URL/id, and bounded failure reason. Tests must verify raw formatter stdout is not emitted.
