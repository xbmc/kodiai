# S02: Formatter command and diff-to-suggestion mapper

**Goal:** Implement a deterministic formatter-suggestion execution and mapping contract that runs a repo-configured formatter command, parses formatter unified diffs, validates suggestion target ranges against a PR diff RIGHT-side index, and returns capped GitHub suggestion payloads plus structured skip/count diagnostics for downstream publication.
**Demo:** Fixture tests prove formatter unified diffs become safe GitHub suggestion payloads, with unmappable hunks skipped and capped.

## Must-Haves

- ## Must-Haves
- `src/execution/formatter-suggestions.ts` exposes a side-effect-injected formatter command runner with statuses for `success`, `no-command`, `no-op`, `failed`, and `timed-out`, plus bounded/redacted stderr diagnostics.
- The formatter command runner supports only allowlisted placeholders (`{baseRef}`, `{headRef}`, `{diffRange}`) and does not stage, commit, push, publish, or mutate GitHub state.
- `parseFormatterUnifiedDiff()` parses git-style unified diffs into file/hunk/line models with old/current and new/formatted ranges, preserving blank formatted lines and conservatively skipping binary, added, deleted, renamed, and malformed files/hunks.
- `buildPrDiffCommentabilityIndex()` records PR diff RIGHT-side commentable line numbers from tracked inline diff fixtures, not ignored planning artifacts.
- `mapFormatterDiffToSuggestions()` emits GitHub review-comment payloads shaped for S03 batching (`path`, `line`, optional `startLine`, `side: "RIGHT"`, markdown suggestion body, raw `suggestionBody`, and source hunk metadata), skips unmappable/unsafe groups, enforces `maxSuggestions`, and returns structured success/no-op/failure/skipped/capped counts.
- Fixture tests in `src/execution/formatter-suggestions.test.ts` prove safe replacements map correctly, unmappable hunks are skipped, pure insert/delete groups are skipped, and excessive formatter hunks are capped with visible skip reasons.
- ## Threat Surface
- **Abuse**: The configured formatter command is repo-controlled arbitrary command execution. S02 must keep execution scoped to the checked-out workspace, use only allowlisted placeholder substitution, require explicit command input, time out hung commands, and avoid any GitHub mutation.
- **Data exposure**: Formatter stderr/stdout can contain paths, tool output, or accidental credentials. Visible diagnostics must be bounded and GitHub-like tokens redacted before returning or logging-visible summaries.
- **Input trust**: Formatter stdout and PR diff text are untrusted parser inputs. Malformed diff headers, binary patches, renames, added/deleted files, off-diff target ranges, and impossible line counts must be skipped rather than guessed.
- ## Requirement Impact
- **Requirements touched**: R078, R082, R083; downstream contract support for R077, R080, R081, R084.
- **Re-verify**: S01 config/mention tests plus all new formatter-suggestion tests: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000`.
- **Decisions revisited**: D195, D196, D198, and D199 remain valid. S02 implements the deterministic formatter-command/diff contract without choosing a new publication mechanism.

## Proof Level

- This slice proves: Contract-level proof with unit/fixture tests. No live GitHub runtime is required in S02; S03/S05 own publication and live smoke. Tests must exercise the boundary contract consumed by S03 by asserting the exact payload fields and skip/count result shape.

## Integration Closure

Upstream surfaces consumed: `src/execution/config.ts` provides `review.formatterSuggestions.command` and `maxSuggestions`; `src/handlers/formatter-suggestion-intent.ts` and `src/execution/types.ts` provide explicit request context for later orchestration; `src/lib/sanitizer.ts` provides token redaction. New wiring introduced in this slice is a pure/importable execution module only, not handler orchestration. Remaining milestone work: S03 publishes these payloads in one PR review, S04 wires explicit/combined mention flows to this module, and S05 proves GitHub accepts a live suggestion.

## Verification

- Runtime signals: formatter command result statuses, exit code, timeout flag, duration, stderr summary, suggestion/skipped/capped counts, and per-skip reason/detail are modeled for S04/S05 logs. Inspection surfaces: executor-visible test assertions and returned result objects from `src/execution/formatter-suggestions.ts`. Failure visibility: no-command/no-op/failed/timed-out statuses plus skip reasons such as `target-range-not-in-pr-diff`, `pure-insertion`, `pure-deletion`, `unsupported-file`, `malformed-diff`, and `max-suggestions-exceeded`. Redaction constraints: stderr summaries must use existing sanitizer redaction and stay bounded before becoming visible diagnostics.

## Tasks

- [x] **T01: Define formatter command runner contract with injected process execution** `est:1h 30m`
  Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R078 needs a repo-configured formatter command execution seam before diff parsing can be useful, and downstream slices need structured success/no-op/failure statuses rather than thrown process details.

Steps:
1. In `src/execution/formatter-suggestions.test.ts`, write RED tests first for missing command (`no-command`), allowlisted placeholder substitution (`{baseRef}`, `{headRef}`, `{diffRange}`), exit 0 with empty stdout (`no-op`), exit 0 with diff stdout (`success`), nonzero exit (`failed` with bounded/redacted stderr summary), and timeout (`timed-out`). Use an injected fake process runner; do not spawn real formatters in unit tests.
2. Run `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` and confirm the new tests fail because the module/API is missing.
3. Create `src/execution/formatter-suggestions.ts` with exported command-result types, `resolveFormatterCommand()`, and `runFormatterCommand()` using an injectable runner and a Bun-backed default runner. Substitute only `{baseRef}`, `{headRef}`, and `{diffRange}`; leave unknown braces untouched or treat them as literal text, but do not evaluate arbitrary expressions.
4. Implement status resolution: blank/missing command returns `no-command`; exit 0 with whitespace-only stdout returns `no-op`; exit 0 with stdout returns `success`; nonzero returns `failed`; timeout returns `timed-out`. Preserve stdout, exit code, duration, timeout flag, resolved command, and a stderr summary truncated to a small bounded size after `redactGitHubTokens()`.
5. Re-run the targeted test command until it passes, then keep the public type names stable for later tasks.

Must-haves:
- The public runner API accepts explicit `workspaceDir`, `command`, `baseRef`, `headRef`, `diffRange`, `timeoutMs`, and optional injected `runProcess`.
- The default runner uses the workspace as process cwd and does not stage, commit, push, call GitHub, or mutate repo state beyond whatever the trusted formatter command itself does.
- Unknown/unsafe placeholder behavior is deterministic and covered by a test.

Failure Modes (Q5): dependency `runProcess` returns nonzero => status `failed` with redacted summary; dependency hangs past timeout => status `timed-out` and process kill attempted by default runner; dependency returns malformed/non-string streams in tests => fake runner should be typed to prevent it and production runner normalizes to strings.

Load Profile (Q6): shared resource is one local subprocess per formatter request; per-operation cost is one shell command plus bounded stdout/stderr buffering; 10x breakpoint is process concurrency/CPU, so S04 should serialize or bound calls later while S02 exposes timeout/duration.

Negative Tests (Q7): blank command, unknown placeholders, token-like stderr, long stderr truncation, nonzero exit, and timeout.
  - Files: `src/execution/formatter-suggestions.ts`, `src/execution/formatter-suggestions.test.ts`, `src/lib/sanitizer.ts`, `src/execution/config.ts`
  - Verify: bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000

- [x] **T02: Parse formatter unified diffs into conservative file and hunk models** `est:2h`
  Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R082 depends on deterministic parsing of formatter output before any safe GitHub line mapping can happen. The existing `src/knowledge/code-snippet-chunker.ts` parser is intentionally insufficient because it drops file headers, deletions, old ranges, binary/rename state, and replacement blocks.

Steps:
1. Extend `src/execution/formatter-suggestions.test.ts` with RED fixture tests for one modified file/one hunk, multiple files and multiple hunks, hunk count defaults (`@@ -10 +10 @@` means count 1), blank added lines preservation, `\\ No newline at end of file` marker ignoring, and conservative skips for binary, added, deleted, renamed, and malformed diffs.
2. Run `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` and confirm these parser tests fail for missing behavior.
3. Extend `src/execution/formatter-suggestions.ts` with exported diff model types (`FormatterDiffFile`, `FormatterDiffHunk`, `FormatterDiffLine`, `FormatterSuggestionSkipReason`) and `parseFormatterUnifiedDiff(diffText: string)` returning parsed files plus structured skipped entries.
4. Implement git unified-diff parsing for `diff --git`, `---`, `+++`, `/dev/null`, `@@ -old,count +new,count @@`, context lines, removed lines, added lines, and no-newline markers. Normalize payload paths by stripping `a/` and `b/` prefixes and skip unsupported file statuses rather than attempting partial mapping.
5. Re-run the targeted tests until all T01 and T02 assertions pass.

Must-haves:
- Parsed hunk line models retain prefix kind (`context`, `removed`, `added`), text without the prefix, and enough old/new cursor data for T03 changed-block mapping.
- File-level unsupported cases return visible skip reasons instead of silently disappearing.
- The parser never reads ignored fixtures; all fixture strings are inline in `src/execution/formatter-suggestions.test.ts`.

Failure Modes (Q5): dependency formatter stdout is malformed => parsed files may be empty and skipped entries identify `malformed-diff`; binary/rename/add/delete are unsupported => skipped with `unsupported-file`-style reasons; impossible hunk counts => skipped rather than guessed.

Load Profile (Q6): shared resources are memory/CPU while parsing diff text; per-operation cost is O(diff lines) with bounded object creation; 10x breakpoint is very large formatter output, so no recursive parsing and no dependency install.

Negative Tests (Q7): empty diff, malformed headers, malformed hunk ranges, binary diff, added file, deleted file, rename, no-newline marker, and blank added line preservation.
  - Files: `src/execution/formatter-suggestions.ts`, `src/execution/formatter-suggestions.test.ts`, `src/knowledge/code-snippet-chunker.ts`
  - Verify: bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000

- [x] **T03: Map safe formatter replacement blocks to capped GitHub suggestion payloads** `est:2h 30m`
  Use installed skills in task-plan frontmatter: `test-driven-development`, `tdd`, `verify-before-complete`.

Why: R082 and R083 require formatter hunks to become deterministic, GitHub-commentable same-PR suggestion payloads while skipping unsafe/unmappable ranges and exposing capped/skipped counts for S03/S04.

Steps:
1. Extend `src/execution/formatter-suggestions.test.ts` with RED tests for `buildPrDiffCommentabilityIndex()` and `mapFormatterDiffToSuggestions()`: one-line replacement maps to `line` only; multi-line replacement maps to `startLine` plus `line`; replacement with different old/new line counts is allowed when every old target line exists in the PR diff RIGHT-side index; pure insertions and pure deletions are skipped; formatter hunks outside the PR diff are skipped; mixed safe/unsafe input returns partial success; `maxSuggestions` keeps first N safe candidates and records `max-suggestions-exceeded` skips.
2. Run `bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000` and confirm the mapper tests fail before implementation.
3. Implement `buildPrDiffCommentabilityIndex(prDiffText)` in `src/execution/formatter-suggestions.ts` by parsing PR diff hunks and recording RIGHT-side line numbers for context (` `) and additions (`+`), excluding deletions (`-`). Return a path-keyed index suitable for exact line-range checks.
4. Implement changed-block extraction from formatter hunks. For each contiguous changed group, target the formatter old/current `-` line range on PR RIGHT side and put the formatter new/formatted `+` lines in `suggestionBody`. Skip pure insertion (`oldCount=0`) and pure deletion (`newCount=0`) groups for S02.
5. Implement `mapFormatterDiffToSuggestions({ formatterDiff, prDiffIndex, maxSuggestions })` returning `suggestions`, `skipped`, `counts`, and `capped`. Suggestion payload body must contain a GitHub markdown block exactly shaped as ```suggestion\n...\n```, with `path`, `line`, optional `startLine`, `side: "RIGHT"`, `suggestionBody`, and source metadata (`oldStart`, `oldEnd`, `newStart`, `hunkHeader`). Enforce maxSuggestions after safety validation and record every dropped safe candidate as `max-suggestions-exceeded`.
6. Run targeted formatter tests, then run the broader S01+S02 regression command: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000`.

Must-haves:
- The mapper never invents PR line mappings: every target old/current line in the formatter replacement range must be present in the RIGHT-side PR diff index for that path.
- The returned payload shape is directly batchable by S03 into `pulls.createReview({ comments: [...] })` after field-name conversion (`startLine` => `start_line`, `side`/`start_side`).
- Result counts distinguish generated suggestions, skipped unsafe/unmappable hunks, capped suggestions, no-op/empty parsed output, and parser skip reasons for S04 reporting.

Failure Modes (Q5): dependency PR diff index lacks target path/range => skip `target-range-not-in-pr-diff`; dependency parsed diff contains unsupported groups => skip with group-level reason; malformed PR diff => index misses ranges and mapper safely skips rather than guessing.

Load Profile (Q6): shared resources are memory/CPU for diff parsing and mapping; per-operation cost is O(PR diff lines + formatter diff lines + candidate groups); 10x breakpoint is very large diffs, mitigated by maxSuggestions cap and no API calls.

Negative Tests (Q7): empty PR diff index, path mismatch, off-by-one target range, pure insertion, pure deletion, mixed safe/unsafe hunks, maxSuggestions = 1 with multiple safe candidates, blank replacement lines, and malformed PR diff hunk.
  - Files: `src/execution/formatter-suggestions.ts`, `src/execution/formatter-suggestions.test.ts`, `src/execution/config.test.ts`, `src/handlers/formatter-suggestion-intent.test.ts`, `src/handlers/mention.test.ts`
  - Verify: bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000

## Files Likely Touched

- src/execution/formatter-suggestions.ts
- src/execution/formatter-suggestions.test.ts
- src/lib/sanitizer.ts
- src/execution/config.ts
- src/knowledge/code-snippet-chunker.ts
- src/execution/config.test.ts
- src/handlers/formatter-suggestion-intent.test.ts
- src/handlers/mention.test.ts
