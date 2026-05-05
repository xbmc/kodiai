# S04 Research: Explicit and combined request orchestration

## Summary

S04 is a targeted orchestration slice. S01 already detects formatter-suggestion mention intent and passes `ExecutionContext.formatterSuggestionRequest`; S02 already provides the formatter command runner, PR-diff commentability index, and safe suggestion mapper; S03 already provides the batched GitHub PR review publisher. What is missing is the glue in the mention PR path that runs those S02/S03 pieces directly from explicit mentions and preserves normal review behavior for combined requests.

Owned requirements for this slice:
- **R080** — `@kodiai review & format suggestions` must run normal review and formatter suggestions from one mention.
- **R084** — formatter failures and combined-mode partial failures must be visible without blocking independent successful subflows.

Requirements supported/advanced:
- **R077** — S04 must keep same-PR committable suggestions by using S03 `pulls.createReview`, not branches/commits/PRs.
- **R081** — S04 must consume the S03 batch publisher, not loop standalone comments.
- **R082/R083** — S04 must feed S02 the PR diff and `maxSuggestions` so safety/cap behavior remains truthful.

Memory lookup for prior notes failed with `database disk image is malformed`, consistent with S01-S03 summaries. Do not depend on GSD memory for this slice.

## Skill/Process Notes

Loaded skills that inform implementation:
- `using-superpowers` — relevant skills should be checked before action.
- `observability` — especially applicable because R084 is a failure-visibility requirement. Use decision-point structured logs, not activity logs; log the reason a formatter subflow was run/skipped and the structured outcome (`commandStatus`, suggestion counts, publisher status, partial failure flags). Do not log formatter stdout or secret-bearing stderr bodies.

Skill discovery:
- Installed relevant skills: `github-bot` is directly relevant for live GitHub API operations, but S04 is code wiring/tests, not live GitHub operation; S05 will need it more.
- `npx skills find "Bun TypeScript"` found `brianlovin/claude-config@bun` (114 installs), `itechmeat/llm-code@bun` (50), and `knoopx/pi@typescript` (32). These are not necessary for S04 because project-local Bun/TS patterns are already clear.
- `npx skills find "Octokit GitHub pull request review"` found PR review skills, but no better fit than existing installed `github-bot`/project tests.

## Implementation Landscape

### Current mention flow (`src/handlers/mention.ts`)

Key existing points:
- Imports S01 intent parser at line 89: `detectFormatterSuggestionRequest`.
- `collectPrReviewPromptDiff()` around lines 953-986 wraps `collectDiffContext()` from `src/handlers/review.ts`, but currently returns only `changedFiles`, `numstatLines`, and `diffRange`; it drops `diffContent`.
- Provisional intent is detected before queueing around lines 1244-1251. Combined mode (`review-and-format`) is treated as explicit review work for review-family coordination.
- Workspace setup for PR mentions around lines 1510-1645 clones the base ref, fetches/checks out `refs/pull/<n>/head`, and fetches the base remote-tracking branch. After this point `workspace.dir` points at PR HEAD.
- Config is loaded after checkout around line 1650.
- Final intent detection happens around lines 1713-1736. `explicitReviewRequest` is true for `isReviewRequest(userQuestion)` or `formatterSuggestionRequest?.mode === "review-and-format"`.
- Format-only requests currently flow to the generic mention prompt/executor path. S01 tests assert this today, but S04 should change this: format-only should run only the formatter suggestion subflow, not Claude.
- Existing executor call is around lines 2678-2702. It passes `formatterSuggestionRequest`, but no downstream code consumes it yet.
- Explicit review publication bridge starts immediately after executor and handles clean-review approval/comment publication. Formatter orchestration should not break this block.
- `postMentionReply()` is a nested helper around lines 1340+ and should be reused for visible setup/no-op/failure surfaces.
- `canPublishExplicitReviewOutput()` is scoped to normal review-family output. Do not use it to suppress formatter suggestions unless you intentionally decide formatter output belongs to the same publish-rights family. S03 has its own idempotency gate via `reviewOutputKey`.

### Current review diff collector (`src/handlers/review.ts`)

`collectDiffContext()` at lines 1416+ returns:
- `changedFiles`, `numstatLines`, optional `diffContent`, `strategy`, `diffRange`, and merge-base recovery metadata.
- It can fall back to GitHub PR files when a `fallbackDiffProvider` is supplied; `buildFallbackPatchDiff()` constructs git-like diff content from `pulls.listFiles` patches.

This is the best source for the PR diff needed by S02 `buildPrDiffCommentabilityIndex()`. For S04, call it with `maxFilesForFullDiff` high enough to request full PR diff for formatter mapping. If `diffContent` is unavailable, the formatter subflow should return a visible/structured failure such as `pr-diff-unavailable` rather than guessing commentability.

### S02 formatter contract (`src/execution/formatter-suggestions.ts`)

Exports to wire:
- `runFormatterCommand({ command, workspaceDir, timeoutMs, baseRef, headRef, diffRange })`
  - Returns `status: "no-command" | "no-op" | "success" | "failed" | "timed-out"` plus bounded/redacted `stderrSummary`, `stdout`, `resolvedCommand`, `exitCode`, `durationMs`.
  - Placeholder semantics are already fixed: only `{baseRef}`, `{headRef}`, `{diffRange}` substitute; unknown placeholders remain literal.
- `buildPrDiffCommentabilityIndex(prDiffText)`
  - Indexes only PR RIGHT-side context/addition lines.
- `mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions })`
  - Returns `suggestions`, `skipped`, `counts`, `capped`.
  - Safe only when fed the PR diff, not the formatter diff.

Important constraint: the configured formatter command is expected to emit a unified diff on stdout. It may or may not mutate the workspace. To avoid the formatter altering the files Claude reviews in combined mode, run normal review/executor before running the formatter subflow, or explicitly reset/avoid mutations. The safer minimal plan is: preserve existing review path first, then run formatter subflow in an independent `try/catch` before final cleanup/logging.

### S03 publisher contract (`src/execution/formatter-suggestion-publisher.ts`)

Use `publishFormatterSuggestionReview()` with:
- `octokit`, `owner`, `repo`, `prNumber`, `commitId`, `suggestions`, optional `reviewOutputKey`, `skipped`, `botHandles`, `logger`.
- It creates exactly one `pulls.createReview({ event: "COMMENT", commit_id, comments })` call.
- Result statuses: `posted`, `skipped`, `no-suggestions`, `blocked`, `failed`.
- It already handles S03 idempotency, secret scanning, mention sanitization, GitHub rejection conversion, and no standalone fallback.

S04 must supply the PR head `commitId`. Best local source after `fetchAndCheckoutPullRequestHeadRef()` is `git -C workspace.dir rev-parse HEAD`; this avoids relying on whether the event surface included `pull_request.head.sha`.

### Existing tests

Relevant test files:
- `src/handlers/mention.test.ts` has S01 coverage under `describe("createMentionHandler formatter suggestion intent context")` around line 12655. These tests currently expect format-only to call `executor.execute`; S04 should update them to expect formatter-only orchestration and no executor call.
- `src/execution/formatter-suggestions.test.ts` covers command/parser/mapper statuses.
- `src/execution/formatter-suggestion-publisher.test.ts` covers S03 publication statuses and payload mapping.

## Recommended Architecture

Add a small orchestration seam instead of inlining all formatter logic into the already-large mention handler.

Recommended new file:
- `src/handlers/formatter-suggestion-orchestration.ts` or `src/execution/formatter-suggestion-orchestration.ts`

Suggested responsibilities:
1. Given workspace/repo/PR/config refs, collect PR diff content.
2. Run S02 formatter command.
3. Convert stdout diff to safe suggestions with S02 mapper.
4. Publish with S03 publisher.
5. Return one structured result that the mention handler can log and render.

Keep side effects injected enough for tests:
- `runFormatterCommand` injectable.
- `collectDiffContext` or `prDiffProvider` injectable.
- `publishFormatterSuggestionReview` injectable.
- `resolveCommitId` injectable if needed.

Do **not** make the executor responsible for formatter suggestions. S04 acceptance says format-only runs only formatter suggestions, and S02/S03 already provide deterministic contracts. The executor can continue to receive `formatterSuggestionRequest` for context compatibility if desired, but the actual formatter subflow should be trusted code.

Suggested result shape:
```ts
type FormatterSuggestionSubflowStatus =
  | "not-requested"
  | "setup-needed"       // no command configured
  | "no-op"              // command produced empty stdout
  | "mapped-no-suggestions"
  | "posted"
  | "duplicate"
  | "blocked"
  | "failed";

interface FormatterSuggestionSubflowResult {
  requested: boolean;
  mode?: "format-only" | "review-and-format";
  status: FormatterSuggestionSubflowStatus;
  commandStatus?: FormatterCommandStatus;
  publisherStatus?: FormatterSuggestionPublisherStatus;
  suggestions: number;
  skipped: number;
  capped: number;
  durationMs?: number;
  reviewUrl?: string;
  reason?: string;
  visibleMessage?: string;
}
```

Visible message rules:
- `no-command`: reply with setup-needed guidance (`review.formatterSuggestions.command` missing). This is required by milestone error strategy.
- `failed`/`timed-out`: concise failure with sanitized `stderrSummary` and exit/timed-out status.
- `no-op`: concise “formatter produced no diff”.
- mapped `no-suggestions`: mention valid suggestions count 0 and summarize top skip reasons/counts.
- publisher `blocked`/`failed`: concise structured failure; never echo secret text or full GitHub error beyond S03 bounded message.
- publisher `skipped`: optional “formatter suggestions already posted for this delivery/head” if explicit request repeats. At minimum log it.
- `posted`: no extra issue comment required; the PR review itself is visible. For combined mode, avoid noisy success comments unless there were skipped/capped diagnostics that need visibility.

## Natural Seams / Task Boundaries

1. **Formatter subflow helper + targeted tests**
   - New helper module wires S02 + S03 contracts with injected fakes.
   - Tests cover: no command, command no-op, command failure/timed-out, missing PR diff, mapper no suggestions with skip summary, posted success, publisher blocked/failed/skipped.
   - This is riskiest and unblocks handler integration.

2. **Mention handler format-only integration**
   - Import helper and default implementations.
   - For `formatterSuggestionRequest?.mode === "format-only"`, bypass `executor.execute` entirely.
   - Run formatter subflow after workspace/config load.
   - Post `visibleMessage` when provided.
   - Log structured outcome with `formatterSuggestionRequest: true`, `formatterMode: "format-only"`, `formatterStatus`, counts, and command/publisher status.
   - Update existing S01 mention tests that currently expect executor context for format-only.

3. **Mention handler combined integration**
   - Preserve existing explicit review prompt/executor/publication behavior.
   - Add guarded formatter subflow execution for `review-and-format` that runs independently of normal review failure/publication failure.
   - To prevent formatter workspace mutations affecting normal review, run formatter after normal executor/review publication work, or ensure the helper runs in a clean/reset diff-only mode. The minimal safer path is after normal review.
   - If normal review throws, catch/store enough to still attempt formatter before rethrowing or posting existing error fallback. Avoid the outer handler catch being the first place executor exceptions are handled for combined mode.
   - Log a combined summary with independent fields: `reviewConclusion`, `reviewPublished`, `formatterStatus`, `formatterPosted`, `combinedPartialFailure`.

4. **Regression/contract tests**
   - Add mention-handler fixture tests for:
     - `@kodiai format suggestions` does **not** call executor and calls formatter publisher when command/diff/suggestions are present.
     - no configured command posts setup guidance and does not call executor.
     - `@kodiai review & format suggestions` calls executor and formatter subflow.
     - executor failure/result failure does not suppress formatter subflow.
     - formatter failure does not suppress executor call or normal review path.
   - Keep S01/S02/S03 tests in the final suite.

## Risk / Pitfalls

- **Diff content availability:** `buildPrDiffCommentabilityIndex()` needs full PR diff text. `collectPrReviewPromptDiff()` currently discards `diffContent`; either extend it or call `collectDiffContext()` directly in the formatter helper.
- **Commit id:** S03 requires `commitId`. Do not use `mention.headRef` (branch name). Use `git rev-parse HEAD` after checkout or `pulls.get().data.head.sha`.
- **Workspace mutation:** Formatter commands might modify files. Do not run formatter before Claude review unless the command is guaranteed diff-only or the workspace is reset afterward.
- **Publish idempotency key:** Use a formatter-specific review output key action, e.g. `action: "mention-format-suggestions"`, not the normal `mention-review` key. For combined requests this lets normal review and formatter suggestion review be independently idempotent.
- **Visible failure surface:** S03 returns structured no-op/blocked/failed but does not post issue comments. S04 must render visible messages for explicit request failures to satisfy R084.
- **Noise:** Do not post a separate success comment when S3 already posted the suggestion review. Only post status comments for setup/no-op/failure/skip summaries.
- **Existing tests will need expectation changes:** S01 format-only tests currently assert executor context. That was correct for S01 but is no longer correct for S04.

## Verification Plan

Targeted commands for executor tasks:

1. Helper tests only:
```bash
bun test ./src/handlers/formatter-suggestion-orchestration.test.ts --timeout 30000
```

2. Mention integration + prior formatter contracts:
```bash
bun test ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000
```

3. Full M066 regression slice suite:
```bash
bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000
```

For S04 acceptance, tests should explicitly assert:
- Format-only request does not call executor.
- Format-only request runs formatter command/map/publisher path.
- Combined request calls normal executor and formatter subflow.
- Formatter command/publisher failure still leaves normal review execution observable.
- Normal review failure/exception still allows formatter subflow to run when workspace/config/PR diff are available.
- Visible reply/comment body is posted for no-command, command failure/timed-out, no suggestions due to skips, blocked publication, and GitHub rejection.
- Structured logs include decision-driving fields without raw formatter stdout or secret values.

## Planner Recommendation

Plan S04 as a three-task slice:
1. Build the formatter subflow helper and renderer with pure/injected tests.
2. Wire format-only mention handling to bypass Claude and publish/report formatter suggestions.
3. Wire combined handling with guarded independent subflows and add failure-independence tests.

Keep all GitHub publication through `publishFormatterSuggestionReview()`. Do not add branch writes, bot commits, standalone inline-comment loops, or a second PR path.