---
estimated_steps: 15
estimated_files: 4
skills_used:
  - test-driven-development
  - tdd
  - verify-before-complete
---

# T01: Define formatter command runner contract with injected process execution

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

## Inputs

- `src/execution/config.ts`
- `src/lib/sanitizer.ts`
- `src/handlers/review.ts`

## Expected Output

- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestions.test.ts`

## Verification

bun test ./src/execution/formatter-suggestions.test.ts --timeout 30000

## Observability Impact

Adds structured formatter command statuses, exit code, duration, timeout flag, and bounded/redacted stderr summary that S04 can log/report independently.
