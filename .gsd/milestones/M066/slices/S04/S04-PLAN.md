# S04: Explicit and combined request orchestration

**Goal:** Wire explicit formatter-suggestion mention requests into the S02 command/mapping pipeline and S03 batched same-PR publisher so format-only requests bypass Claude while combined review+format requests run normal review and formatter suggestions as independently reported subflows.
**Demo:** `@kodiai format suggestions` runs only formatter suggestions, while `@kodiai review & format suggestions` runs normal review plus formatter suggestions without either subflow blocking the other.

## Must-Haves

- `@kodiai format suggestions` on a PR does not invoke `executor.execute`; it runs the formatter command/diff/map/publish subflow and posts only setup/no-op/failure diagnostics when needed.
- `@kodiai review & format suggestions` preserves existing explicit review routing/publication and also runs the formatter subflow.
- Formatter command, mapper, publisher, PR-diff, and commit-id failures become structured subflow results and visible comments for explicit requests without logging raw formatter stdout or secret-bearing stderr.
- Normal review failure or exception in combined mode does not suppress a formatter attempt when workspace/config/PR identity are available; formatter failure does not suppress normal review execution/publication.
- Formatter publication continues to use `publishFormatterSuggestionReview()` and one Pull Request Review batch only; no branch pushes, bot commits, standalone comment loops, or new PRs are introduced.
- Requirement coverage: R080 is directly proven by combined-mode tests; R084 is directly proven by visible diagnostics and independent failure tests; R077/R081/R082/R083 remain supported by consuming S02/S03 contracts.

## Proof Level

- This slice proves: Integration contract proof through Bun tests around the real mention handler entrypoint plus pure subflow tests with injected fakes. No live GitHub runtime is required in S04; S05 remains responsible for deployed smoke proof.

## Integration Closure

Consumes S01 mention/config semantics (`src/handlers/formatter-suggestion-intent.ts`, `src/execution/config.ts`), S02 formatter command/mapper (`src/execution/formatter-suggestions.ts`), and S03 batched publisher (`src/execution/formatter-suggestion-publisher.ts`). Introduces the runtime composition seam in `src/handlers/mention.ts` and a focused helper in `src/handlers/formatter-suggestion-orchestration.ts`. Remaining milestone work after S04 is S05 live GitHub acceptance proof and operator docs.

## Verification

- Add structured decision/result logs for formatter subflow request mode, run/skip reason, command status, mapper counts, publisher status, posted/skipped/capped counts, partial-failure flags, and bounded error categories. Visible PR replies/comments are planned for setup-needed, no-op, command failure/timeout, missing PR diff, mapped no-suggestions with skip summary, publisher duplicate/blocked/failed outcomes. Redaction constraint: do not log raw formatter stdout or full stderr; use S02 bounded/redacted stderrSummary and S03 bounded publisher rejection fields only.

## Tasks

- [x] **T01: Build formatter suggestion subflow helper with visible result rendering** `est:2h`
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
  - Files: `src/handlers/formatter-suggestion-orchestration.ts`, `src/handlers/formatter-suggestion-orchestration.test.ts`, `src/execution/formatter-suggestions.ts`, `src/execution/formatter-suggestion-publisher.ts`, `src/handlers/review.ts`, `src/handlers/review-idempotency.ts`
  - Verify: bun test ./src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000

- [ ] **T02: Wire format-only PR mentions to bypass Claude and run formatter suggestions** `est:2h`
  Executor skills expected in task plan frontmatter: `using-superpowers`, `test-driven-development`, `observability`, `verify-before-complete`.

Why: S04's first user-visible behavior change is that `@kodiai format suggestions` should run only the deterministic formatter suggestion subflow, not the generic Claude mention executor. This task integrates the T01 helper into the real mention handler for format-only requests and updates the S01-era tests whose old expectations were intentionally provisional.

Steps:
1. Import the T01 helper into `src/handlers/mention.ts` and add an optional dependency injection seam on `createMentionHandler()` (for example `formatterSuggestionSubflow?: typeof runFormatterSuggestionSubflow`) so mention tests can assert orchestration without invoking real formatter/GitHub code.
2. After workspace checkout and repo config load, detect `formatterSuggestionRequest?.mode === "format-only"` for PR surfaces and run the formatter subflow with workspace dir, repo/PR identity, base/head refs, `config.review.formatterSuggestions.command`, `config.review.formatterSuggestions.maxSuggestions`, bot handles, delivery/installation ids, fallback PR files provider, and installation Octokit. Do this before building a Claude prompt and before `executor.execute`.
3. If the subflow returns `visibleMessage`, post it through the existing `postMentionReply()`/error-comment path with mention sanitization. If it returns `posted`, rely on the PR review as the visible success surface and avoid adding a noisy success issue comment unless skipped/capped diagnostics are part of the visible message.
4. Log one structured format-only completion event with `formatterSuggestionRequest: true`, `formatterMode: "format-only"`, `formatterStatus`, `commandStatus`, `publisherStatus`, `suggestions`, `skipped`, `capped`, and whether a visible reply was posted. Do not include stdout or unbounded stderr.
5. Update `src/handlers/mention.test.ts` around the formatter-intent context block so format-only fixtures assert `executor.execute` is not called, the injected formatter subflow is called with config and PR identity, setup guidance is posted when no command is configured, and publisher success does not create an extra success issue comment.

Must-haves:
- Format-only requests stay read-only (`writeMode` remains false) and never enter write-mode PR creation paths.
- Format-only requests bypass Claude entirely; `executor.execute` must not be called.
- The path uses the T01 helper and S03 publisher contract; it must not create standalone issue/inline comments for suggestions.
- Visible diagnostics exist for no-command/setup-needed and failure/no-suggestion cases.

Failure Modes (Q5):
| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| Formatter subflow helper | Post returned visible failure message and log structured result; do not call executor as fallback | Same as error with timeout status/reason | If helper returns unknown/failed status, post bounded fallback diagnostic and log fields |
| GitHub reply/comment API | Log non-blocking reply failure; do not retry with unsafe alternate publication | Log non-blocking timeout/failure | Treat malformed response as failed visible-reply attempt, not formatter success |

Load Profile (Q6):
- Shared resources: mention job queue, workspace clone, formatter process, GitHub issue/review APIs.
- Per-operation cost: one formatter subflow and at most one diagnostic issue/review-thread reply; no Claude executor cost.
- 10x breakpoint: formatter child process concurrency and GitHub API rate limits; existing queueing plus S02 timeout/cap and S03 batching must remain the bounding mechanisms.

Negative Tests (Q7):
- Malformed inputs: missing formatter command, missing base ref, helper result with zero suggestions.
- Error paths: helper returns command failed/timed-out, publisher blocked/failed, diagnostic comment API fails non-blockingly.
- Boundary conditions: posted success with capped/skipped diagnostics; repeated duplicate skip.
  - Files: `src/handlers/mention.ts`, `src/handlers/mention.test.ts`, `src/handlers/formatter-suggestion-orchestration.ts`, `src/handlers/formatter-suggestion-orchestration.test.ts`
  - Verify: bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000

- [ ] **T03: Wire combined review-and-format mentions with independent subflow failure handling** `est:2.5h`
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
  - Files: `src/handlers/mention.ts`, `src/handlers/mention.test.ts`, `src/handlers/formatter-suggestion-orchestration.ts`, `src/execution/formatter-suggestions.test.ts`, `src/execution/formatter-suggestion-publisher.test.ts`
  - Verify: bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000 && bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000

## Files Likely Touched

- src/handlers/formatter-suggestion-orchestration.ts
- src/handlers/formatter-suggestion-orchestration.test.ts
- src/execution/formatter-suggestions.ts
- src/execution/formatter-suggestion-publisher.ts
- src/handlers/review.ts
- src/handlers/review-idempotency.ts
- src/handlers/mention.ts
- src/handlers/mention.test.ts
- src/execution/formatter-suggestions.test.ts
- src/execution/formatter-suggestion-publisher.test.ts
