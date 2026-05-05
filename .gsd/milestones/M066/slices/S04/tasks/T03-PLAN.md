---
estimated_steps: 6
estimated_files: 5
skills_used:
  - using-superpowers
  - test-driven-development
  - observability
  - verify-before-complete
---

# T03: Wire combined review-and-format mentions with independent subflow failure handling

Executor skills expected in task plan frontmatter: `using-superpowers`, `test-driven-development`, `observability`, `verify-before-complete`.

Why: The milestone's core demo requires `@kodiai review & format suggestions` to run normal review plus formatter suggestions from one mention. The risk is accidental coupling: normal review failures must not suppress formatter suggestions, and formatter failures must not suppress normal review routing/publication.

Steps:
1. In `src/handlers/mention.ts`, preserve existing explicit-review prompt building, executor dispatch, approval/comment bridge, and fallback behavior for `formatterSuggestionRequest?.mode === "review-and-format"`.
2. After normal review executor/publication handling, run the T01 formatter subflow in a guarded `try/catch` with the same PR/workspace/config inputs used by format-only. Run the formatter after normal review work so formatter commands that mutate the workspace cannot affect Claude's review context.
3. Add an executor-exception path for combined mode: if `executor.execute` throws after workspace/config setup, attempt the formatter subflow before rethrowing to the existing outer handler error path. Log that normal review failed before formatter execution and preserve the original error for the existing visible review failure behavior.
4. Post formatter `visibleMessage` when present without using `canPublishExplicitReviewOutput()` for formatter publication; S03 has its own formatter review-output key/idempotency gate. Keep normal review output keys and formatter output keys independent.
5. Add/update `src/handlers/mention.test.ts` fixtures proving combined requests call both executor and formatter subflow, executor result failure still attempts formatter, executor thrown error still attempts formatter before outer error handling, formatter failure does not suppress executor or normal review fallback, and structured logs include independent `reviewConclusion`/`publishResolution` and `formatterStatus`/partial-failure fields.
6. Run targeted integration/regression commands, then the full M066 regression suite.

Must-haves:
- Combined mode still uses review task routing (`review.small-diff`/`review.full` as appropriate), `enableInlineTools: true`, and normal review output publication behavior.
- Formatter subflow runs independently and uses formatter-specific idempotency/publication; it is not blocked by normal review publish-rights gates.
- Partial failures are visible and logged: formatter failure with review success, review failure with formatter success, and both failed.
- No branch writes, bot commits, standalone suggestion comments, or separate PRs are introduced.

Failure Modes (Q5):
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| Claude executor/normal review | Attempt formatter subflow if workspace/config are available, then preserve existing review error/fallback behavior | Same as error; formatter still attempted if possible | Treat result conclusion/failure fields truthfully and still run formatter |
| Formatter subflow | Log/post formatter diagnostic but do not alter review result/publication | Same as error with timeout status/reason | Post/log bounded failure/no-suggestions message; do not publish unsafe suggestions |
| GitHub review/comment APIs | Preserve existing normal review fallback; formatter publisher/diagnostic failures are separate fields | Preserve existing timeout/error classification | Malformed publisher/result fields become formatter failed status without corrupting review publication |

Load Profile (Q6):
- Shared resources: one Claude executor run, one formatter process, one normal review publication attempt, and one formatter review publication attempt for a combined mention.
- Per-operation cost: existing explicit-review cost plus one formatter subflow; formatter runs after review to avoid workspace mutation affecting prompt/executor.
- 10x breakpoint: combined requests are heavier than either subflow alone; queueing/coordinator should continue to control review-family concurrency, and formatter caps/timeout must bound formatter work.

Negative Tests (Q7):
- Malformed inputs: missing command in combined mode, missing PR diff, no mapped suggestions.
- Error paths: executor returns `error`/`failure`, executor throws, formatter command fails/times out, publisher blocked/failed.
- Boundary conditions: normal review succeeds and formatter duplicate-skips; formatter posts suggestions while normal review fallback posts an error; formatter fails while normal review publishes normally.

## Inputs

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/formatter-suggestion-orchestration.ts`
- `src/handlers/formatter-suggestion-orchestration.test.ts`
- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestion-publisher.ts`

## Expected Output

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/formatter-suggestion-orchestration.test.ts`

## Verification

bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000 && bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000

## Observability Impact

Adds combined-mode summary signals with independent review and formatter outcomes plus a `combinedPartialFailure` flag. These logs should distinguish review execution failure, review publication failure, formatter command failure, formatter publication failure, duplicate skip, and posted formatter review.
