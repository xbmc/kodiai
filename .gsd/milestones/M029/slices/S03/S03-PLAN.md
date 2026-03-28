# S03: Issue Cleanup Script

**Goal:** Ship `scripts/cleanup-wiki-issue.ts` — a dry-run-safe one-time operational script that lists and deletes comments from a GitHub issue by marker scan.
**Demo:** `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run` runs successfully (with live GitHub credentials), prints a per-comment table of deletion targets, and exits 0 without mutating GitHub state.

## Must-Haves

- `scripts/cleanup-wiki-issue.ts` exists and TypeScript-compiles cleanly
- Auth follows `cleanup-legacy-branches.ts` exactly (`getInstallationOctokit` via `createGitHubApp`)
- Default mode (no flags) deletes comments that lack `<!-- kodiai:wiki-modification:` marker
- `--delete-all` deletes ALL comments regardless of marker presence
- `--dry-run` is the default; mutations require explicit `--no-dry-run`
- Required args `--owner`, `--repo`, `--issue-number` — script exits 1 with clear error if missing
- Output: one line per comment with `[DRY RUN]`/`[DELETED]`/`[FAILED]` prefix + summary block

## Observability / Diagnostics

- **Runtime signals**: Script emits per-comment lines tagged `[DRY RUN]`, `[DELETED]`, or `[FAILED]` to stdout, making it safe to capture in CI logs or tee to a file.
- **Structured log level**: `LOG_LEVEL` env var controls pino verbosity (default `info`); set `LOG_LEVEL=debug` to see intermediate pagination and auth diagnostics.
- **Failure visibility**: Auth failures (`getRepoInstallationContext` returns null) and individual deletion errors are printed to stdout with the tag `[FAILED]` or `ERROR:` prefix, making them grep-able.
- **Summary block**: A `--- Summary ---` block is always printed at exit regardless of dry-run or error state, giving an audit count.
- **Redaction**: Private key material is never echoed; only the app ID and owner/repo are logged.
- **Inspection command**: `LOG_LEVEL=debug bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run 2>&1 | head -50` surfaces auth and pagination internals without mutating state.

## Verification

- `bun scripts/cleanup-wiki-issue.ts --help` exits 0 and prints usage
- `bun --check scripts/cleanup-wiki-issue.ts` exits 0 (TypeScript syntax check)
- Manual dry-run against live issue (requires `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY`): `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run`
- **Failure-path check**: `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki` exits 1 and stderr/stdout contains `ERROR: --issue-number is required`

## Tasks

- [x] **T01: Write cleanup-wiki-issue.ts script** `est:45m`
  - Why: This is the entire S03 deliverable — a one-time operational script for cleaning garbage comments from xbmc/wiki issue #5 before S04 re-publication.
  - Files: `scripts/cleanup-wiki-issue.ts`
  - Do: Port `cleanup-legacy-branches.ts` structure; adapt business logic for issue comment listing/deletion. Full details in T01-PLAN.md.
  - Verify: `bun --check scripts/cleanup-wiki-issue.ts && bun scripts/cleanup-wiki-issue.ts --help`
  - Done when: Script compiles, `--help` exits 0, all required-arg validation paths exit 1 with error message.

## Files Likely Touched

- `scripts/cleanup-wiki-issue.ts`
