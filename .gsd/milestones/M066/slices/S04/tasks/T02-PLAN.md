---
estimated_steps: 5
estimated_files: 4
skills_used:
  - using-superpowers
  - test-driven-development
  - observability
  - verify-before-complete
---

# T02: Wire format-only PR mentions to bypass Claude and run formatter suggestions

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

## Inputs

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/formatter-suggestion-orchestration.ts`
- `src/handlers/formatter-suggestion-orchestration.test.ts`
- `src/handlers/formatter-suggestion-intent.ts`

## Expected Output

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`

## Verification

bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000

## Observability Impact

Adds real mention-handler logs and visible diagnostic behavior for format-only explicit requests. Future agents should be able to see why a formatter request ran or stopped without inspecting Claude executor output.
