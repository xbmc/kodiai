# S02 Research: Formatter command and diff-to-suggestion mapper

## Summary

S02 should be a contract-heavy, mostly deterministic TypeScript slice. The repo already has the S01 config/mention seam (`review.formatterSuggestions.{automatic,command,maxSuggestions}` and `ExecutionContext.formatterSuggestionRequest`), but there is no formatter runner, no full unified-diff parser for formatter output, and no GitHub suggestion payload mapper. The natural implementation seam is a new pure/testable module under `src/execution/` (recommended: `src/execution/formatter-suggestions.ts`) plus a focused test file with inline unified-diff fixtures.

Key risk: a formatter diff is against the PR head, while GitHub review suggestions must comment on PR diff lines. A safe mapper should parse formatter hunks into changed blocks and then validate those target ranges against a PR-diff index before producing payloads. Do not guess line mappings; skip when no existing RIGHT-side PR diff range can be proven.

Memory lookup was attempted first per auto-mode instructions, but the GSD memory DB returned `database disk image is malformed`. Treat durable memory as unavailable for this slice.

## Requirements Targeted

Primary/owned by S02:

- **R078** — implement repo-configured formatter command execution suitable for `git-clang-format`, with an adapter seam for later formatters.
- **R082** — deterministic safe diff-to-GitHub-suggestion mapping; invalid/unmappable hunks must be skipped.
- **R083** — cap suggestions and surface skip reasons for unsafe/excessive formatter hunks.

Supported/downstream contract:

- **R077** — S02 must output payloads that S03 can publish as same-PR committable suggestions, not commits/branches.
- **R081** — S02 should shape payloads in the form S03 can batch into `pulls.createReview({ comments: [...] })`.
- **R080/R084** — S02 should return structured success/no-op/failure/skipped counts so S04 can independently report formatter subflow results in combined mode.

## Skill Discovery

Installed skills directly relevant to future execution:

- `github-bot` exists, but S02 does not need live GitHub API actions; S03/S05 may use it.
- `api-design` exists, but S02 is shaping internal models rather than a public HTTP API.
- `test-driven-development` / `tdd` exist and should be used by executors because this slice has a clear observable contract and fixture-heavy parser behavior.
- `verify-before-complete` / `verification-before-completion` apply before claiming completion; final evidence should be a fresh `bun test` command.

Marketplace search results checked but not installed:

- `npx skills find "unified diff parser TypeScript"` returned mostly generic TypeScript skills and `somarkai/skills@document-diff` (11 installs). Not obviously worth installing for this codebase-specific unified-diff mapper.
- `npx skills find "GitHub pull request suggestions API"` returned broad PR skills (`github/awesome-copilot@my-pull-requests`, 9.2K installs; others lower). Not useful for S02’s deterministic parser/mapper.

## Existing Implementation Landscape

### S01 seams already present

- `src/execution/config.ts`
  - Defines `formatterSuggestionsSchema` with:
    - `automatic: z.boolean().default(false)`
    - `command: z.string().min(1).optional()`
    - `maxSuggestions: z.number().min(1).max(100).default(10)`
  - `RepoConfig` is exported from the same file and already includes the new config field.
  - Section fallback parsing means invalid nested `review` config can fall back to defaults; S02 should treat missing/invalid `command` as setup-needed/no-command, not disabled.

- `src/execution/types.ts`
  - `ExecutionContext` now has `formatterSuggestionRequest?: FormatterSuggestionRequest`.
  - It does **not** currently include `baseRef`, `headSha`, or `diffRange`. S02 can build pure functions with these as explicit inputs; S04 will need to wire real handler context into them.

- `src/handlers/formatter-suggestion-intent.ts`
  - Defines `FormatterSuggestionRequest` and recognizes `format-only` vs `review-and-format`.

- `src/handlers/mention.ts`
  - PR mention workspaces clone the base branch, fetch/check out `refs/pull/<n>/head`, then fetch the base tracking branch. After that `origin/${baseRef}...HEAD` and fallback `origin/${baseRef}..HEAD` are available.
  - Existing mention tests prove `@kodiai format suggestions` remains read-only and `@kodiai review & format suggestions` preserves review routing.

### Existing diff/command patterns to reuse or avoid

- `src/handlers/review.ts`
  - `collectDiffContext()` already implements safe-ish git diff collection with merge-base recovery, timeout, and fallback to GitHub PR file patches.
  - `runDiffCommandWithTimeout()` uses `Bun.spawn(["git", "-C", workspaceDir, ...args])`, reads stdout/stderr, kills on timeout, and returns `{ exitCode, stdout, stderr, timedOut }`.
  - This function is local to `review.ts`. S02 can copy/extract the timeout pattern, but a standalone formatter runner should avoid coupling to the huge review handler.

- `src/knowledge/code-snippet-chunker.ts`
  - Contains a small hunk parser (`parseDiffHunks`) but it only extracts added lines for embedding. It does not parse file headers, old ranges, deletions, binary diffs, renames, or replacement blocks. It is not sufficient for GitHub suggestions.
  - Its tests are useful style references: inline fixtures, `bun:test`, focused assertions.

- `package.json`
  - No existing unified-diff parsing dependency is installed.
  - `picomatch`, `zod`, `js-yaml`, Octokit, and Bun are available.
  - Context7 did not find a good TypeScript `parse-diff` documentation match. Adding a dependency is probably unnecessary for the limited parser needed here.

### Existing GitHub suggestion/publication prior art

- `src/execution/mcp/inline-review-server.ts`
  - Tool description explicitly says GitHub suggestion blocks use:
    ````markdown
    ```suggestion
    replacement code
    ```
    ````
  - Important established rule: suggestion block replaces the **entire** commented line range.
  - Existing payload fields are `path`, `line`, optional `startLine`, `side` default `RIGHT`; API params become `line`, optional `start_line`, `side`, optional `start_side`.
  - It currently publishes single review comments via `pulls.createReviewComment`; S03 will publish batches via `pulls.createReview`.

- `src/handlers/review-idempotency.ts`
  - Existing idempotency marker format is `<!-- kodiai:review-output-key:<key> -->` via `buildReviewOutputMarker()`.
  - S02 should not implement idempotency, but the suggestion payload/result should preserve source hunk metadata that S03 can hash/mark.

### GitHub docs constraints (external docs checked)

Search query used: `GitHub suggested changes pull request review comment API line start_line side suggestion block replaces range`.

GitHub REST review docs for `Create a review for a pull request` state:

- `pulls.createReview` accepts `commit_id`, `body`, `event`, and a `comments` array.
- Each `comments` item supports `path`, `body`, legacy `position`, and modern `line`, `side`, `start_line`, `start_side`.
- Creating a review requires Pull requests write permission.
- GitHub returns `422` for validation failures/spam.
- Docs still note that comment positions/lines must correspond to the PR diff; line mapping cannot be invented.

## Recommended Architecture

### New module boundary

Create one new execution module with pure functions and injectable side effects:

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`

Recommended public types/functions:

```ts
export type FormatterCommandStatus = "success" | "no-command" | "no-op" | "failed" | "timed-out";

export type FormatterCommandResult = {
  status: FormatterCommandStatus;
  command?: string;
  exitCode?: number;
  stdout: string;
  stderrSummary?: string;
  durationMs?: number;
  timedOut?: boolean;
};

export type FormatterDiffFile = {
  oldPath: string | null;
  newPath: string | null;
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "binary";
  hunks: FormatterDiffHunk[];
  skipReason?: FormatterSuggestionSkipReason;
};

export type FormatterDiffHunk = {
  filePath: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: FormatterDiffLine[];
};

export type FormatterSuggestionPayload = {
  path: string;
  line: number;
  startLine?: number;
  side: "RIGHT";
  body: string; // should already contain a suggestion block, or expose suggestionBody separately for S03
  suggestionBody: string;
  source: {
    oldStart: number;
    oldEnd: number;
    newStart: number;
    hunkHeader: string;
  };
};

export type FormatterSuggestionMappingResult = {
  suggestions: FormatterSuggestionPayload[];
  skipped: Array<{ path?: string; reason: FormatterSuggestionSkipReason; detail?: string }>;
  capped: number;
};
```

Keep the module small but split internally into three seams:

1. `runFormatterCommand()` — side-effecting, injectable command runner.
2. `parseUnifiedDiff()` — pure parser from stdout to file/hunk/change-block model.
3. `mapFormatterDiffToSuggestions()` — pure mapper with cap enforcement and skip reasons.

### Command runner recommendation

Inputs should be explicit and test-injectable:

```ts
runFormatterCommand({
  workspaceDir,
  command,
  placeholders: { baseRef, headRef, diffRange },
  timeoutMs,
  runProcess?,
})
```

Suggested behavior:

- Missing/blank command => `{ status: "no-command", stdout: "" }`.
- Substitute only a small allowlist of placeholders, e.g. `{baseRef}`, `{headRef}`, `{diffRange}`. Avoid arbitrary template evaluation.
- Use `Bun.spawn(["bash", "-lc", resolvedCommand], { cwd: workspaceDir, stdout: "pipe", stderr: "pipe" })` or an injectable equivalent.
  - A repo-configured formatter command is inherently arbitrary code execution; running through a shell is acceptable if documented as repo-trusted config.
  - Tests should use an injected process runner; do not need real shell commands except maybe one smoke-style temp repo test.
- Treat exit code 0 with empty/whitespace stdout as `no-op`.
- Treat nonzero as `failed`, preserving stdout for diagnostics only if useful, and truncate/redact stderr.
- Truncate stderr summary to a bounded size (for example 2 KiB) and redact tokens using existing sanitizer primitives (`redactGitHubTokens()` and/or `scanOutgoingForSecrets()` before anything visible is published later).
- Do not stage, commit, push, or mutate GitHub state.

Open question for S04 wiring: handlers currently know `baseRef`/`headRef`, but `ExecutionContext` does not. Keep S02 runner parameterized; add context fields later only when orchestration needs them.

### Diff parser recommendation

Do not reuse `parseDiffHunks()` from `code-snippet-chunker.ts`; it drops exactly the data needed here.

Parser should support enough git unified diff syntax for fixtures:

- `diff --git a/path b/path`
- `--- a/path`, `+++ b/path`
- `/dev/null` for added/deleted files
- `@@ -oldStart,oldCount +newStart,newCount @@ optional context`
- hunk lines prefixed by ` `, `-`, `+`
- `\ No newline at end of file`
- `Binary files ... differ`
- `rename from` / `rename to` (skip initially unless mapping is proven)

Skip file-level cases conservatively:

- binary diff
- deleted file
- added file (no existing RIGHT-side range to replace)
- rename without a simple same-path modified hunk
- missing/invalid file headers
- hunk with malformed line counts

### Mapping recommendation

Important semantic distinction:

- Formatter diff old side (`---`) is the current PR head content.
- Formatter diff new side (`+++`) is the formatted replacement.
- GitHub suggestion should comment on the PR’s RIGHT side over the formatter diff **old** line range, with the suggestion block containing formatter diff **new** lines.

Recommended block mapper:

1. Within each hunk, scan contiguous changed groups separated by context lines.
2. For each group, collect removed/current lines (`-`) and added/formatted lines (`+`) while tracking the current old line cursor.
3. Only map groups with at least one `-` line and at least one `+` line.
4. Skip pure insertion groups (`oldCount=0`) and pure deletion groups (`newCount=0`) for S02. Empty suggestion bodies may work in GitHub in some contexts, but they are risky and not needed for first safe version.
5. Suggestion target range:
   - `startLine = oldStart` when replacement covers more than one old line.
   - `line = oldEnd` always.
   - `side = "RIGHT"` and S03 should convert to `start_line` / `start_side` for Octokit.
6. Suggestion body is exact `+` lines joined with `\n`, preserving blank lines and indentation.
7. Enforce `maxSuggestions` after safe mapping; extra safe candidates should be skipped with reason `max-suggestions-exceeded`, not silently dropped.

### PR diff commentability index

To satisfy “unmappable hunks skipped” and reduce S03 GitHub 422s, add an optional/required PR diff index input:

```ts
export type PrDiffCommentabilityIndex = Map<string, Set<number>>; // RIGHT-side line numbers visible in PR diff
```

Build it by parsing the PR diff (`origin/${baseRef}...HEAD` or fallback two-dot diff) and recording RIGHT-side line numbers for hunk context (` `) and additions (`+`). Deletions (`-`) have no RIGHT line. Then require every target line in a formatter suggestion range to be present for that path. If not, skip with `target-range-not-in-pr-diff`.

This is the biggest quality lever for S02. Without it, S02 can create syntactically shaped suggestions that S03/GitHub rejects because the formatter touched lines outside the PR diff.

## Suggested Task Decomposition for Planner

### Task 1 — Command runner result contract

Files:

- `src/execution/formatter-suggestions.ts` (new)
- `src/execution/formatter-suggestions.test.ts` (new)

Build:

- Types for command result and runner injection.
- Placeholder substitution with a small allowlist.
- Timeout/nonzero/no-op handling.
- Bounded stderr summary/redaction.

Tests:

- missing command => `no-command`
- placeholder substitution (`{baseRef}`, `{headRef}`, `{diffRange}`)
- exit 0 empty stdout => `no-op`
- exit 0 diff stdout => `success`
- nonzero => `failed` with truncated stderr summary
- timeout => `timed-out`

### Task 2 — Unified diff parser for formatter output

Files:

- Same module/test file, or split to `src/execution/formatter-diff.ts` only if the first file gets too large.

Build:

- Parser producing file/hunk/line model with old/new ranges and path status.
- Conservative file-level skips for binary/added/deleted/rename/malformed.

Tests:

- single modified file, one hunk
- multiple files and multiple hunks
- line count defaults (`-10 +10` means count 1)
- blank added lines preserved
- `\ No newline at end of file` ignored
- binary/added/deleted/rename/malformed skipped with reasons

### Task 3 — PR diff index + safe suggestion mapper + cap

Files:

- Same module/test file.

Build:

- PR diff RIGHT-side line index parser.
- Changed-block extraction from formatter hunks.
- Suggestion payload generation with `path`, `line`, optional `startLine`, `side: "RIGHT"`, and suggestion body.
- Skip/cap accounting.

Tests:

- one-line replacement maps to `line` only and correct suggestion body.
- multi-line replacement maps to `startLine` + `line`.
- replacement with different line counts is allowed as long as old target range exists.
- pure insertions and pure deletions skipped.
- formatter hunk outside PR diff skipped as unmappable.
- maxSuggestions cap keeps first N safe candidates and records cap skips.
- mixed safe + unsafe returns partial success with skip reasons.

## Verification Recommendation

Fresh final verification should run at least:

```bash
bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000
```

Recommended broader regression after S02 because it consumes S01 config shapes and may add exports/types:

```bash
bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/execution/formatter-suggestions.test.ts --timeout 30000
```

If executors split modules, include all new formatter test files in the command.

## Risks / Watchpoints

- **GitHub line validity:** Formatting a line outside the PR diff cannot be commented on as a PR review suggestion. Use a PR diff index and skip those hunks.
- **Whole-hunk replacement is too broad:** Replacing an entire unified hunk would include context lines and can produce noisy or invalid suggestions. Map changed blocks within hunks instead.
- **Formatter diff direction:** Comment range comes from formatter diff old/current lines; suggestion body comes from formatter diff new/formatted lines.
- **Pure insert/delete hunks:** GitHub suggested deletion/insert behavior is tricky. Skip in S02 unless live proof later demands support.
- **Command config is arbitrary:** This is repo-controlled and expected, but avoid arbitrary placeholder evaluation and keep timeout/stderr redaction.
- **Path prefixes:** Normalize `a/`/`b/` prefixes and `/dev/null`; GitHub payload paths should be repo-relative without `a/` or `b/`.
- **Renames:** Skip initially. A later adapter can support `previous_filename`/renamed PR files if needed.
- **No current memory store:** memory_query failed with a malformed DB; do not rely on captured project memories for executor context.

## Sources / Evidence

- `src/execution/config.ts` — S01 config schema/defaults for formatter suggestions.
- `src/execution/types.ts` — `ExecutionContext.formatterSuggestionRequest` seam.
- `src/handlers/formatter-suggestion-intent.ts` — mention intent descriptor shape.
- `src/handlers/mention.ts` — PR workspace checkout/fetch pattern and S01 context handoff.
- `src/handlers/review.ts` — existing git diff timeout/fallback patterns and hunk embedding pipeline.
- `src/knowledge/code-snippet-chunker.ts` / `.test.ts` — prior small diff parser, useful style but insufficient data model.
- `src/execution/mcp/inline-review-server.ts` — existing suggestion-block syntax and line/startLine/side precedent.
- `src/handlers/review-idempotency.ts` — marker patterns S03 will likely reuse.
- GitHub REST docs fetched from `https://docs.github.com/en/rest/pulls/reviews?apiVersion=2026-03-10` after search query: `GitHub suggested changes pull request review comment API line start_line side suggestion block replaces range`.
