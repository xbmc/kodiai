---
id: S03
milestone: M029
status: complete
completed_at: 2026-03-21T23:15:00Z
tasks: [T01]
verification_result: passed
---

# S03: Issue Cleanup Script — Summary

## What Was Delivered

`scripts/cleanup-wiki-issue.ts` — a dry-run-safe one-time operational script that lists and deletes comments from a GitHub issue by marker scan.

**Primary deliverable:**
- `scripts/cleanup-wiki-issue.ts` (~220 lines) — new script, TypeScript-clean, dry-run-default

## How It Works

The script authenticates via `getInstallationOctokit` (GitHub App auth, same pattern as `cleanup-legacy-branches.ts`). It paginates through all comments on the specified issue using a manual `for (let page = 1; ; page++)` loop (matching the `wiki-publisher.ts` pattern rather than `paginate.iterator`).

**Comment classification:** Default mode targets comments that lack the `<!-- kodiai:wiki-modification:` marker. `--delete-all` overrides to target every comment regardless of marker.

**Mutation gate:** `--dry-run` is the default; `--no-dry-run` is required to actually delete. This prevents accidental state mutation when the script is invoked without explicit intent.

**Output:** Per-comment lines tagged `[DRY RUN]`, `[DELETED]`, or `[FAILED]` with comment ID, reason, and body snippet. A `--- Summary ---` block is always printed at exit with total/targets/deleted/errors counts.

## Verification Results

All slice-level checks passed:

| Check | Command | Exit | Result |
|-------|---------|------|--------|
| `--help` exits 0 | `bun scripts/cleanup-wiki-issue.ts --help` | 0 | ✅ pass |
| TypeScript check | `bun --check scripts/cleanup-wiki-issue.ts` | 0 | ✅ pass |
| Missing `--issue-number` exits 1 | `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki` | 1 | ✅ pass |
| Invalid `--issue-number` exits 1 | `...--issue-number abc` | 1 | ✅ pass |
| Missing `--owner` exits 1 | `bun scripts/cleanup-wiki-issue.ts --repo wiki --issue-number 5` | 1 | ✅ pass |
| Missing `--repo` exits 1 | `bun scripts/cleanup-wiki-issue.ts --owner xbmc --issue-number 5` | 1 | ✅ pass |

Live dry-run against xbmc/wiki issue #5 (requires `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY`) is deferred to S04 execution per plan — S04 runs the actual cleanup as part of its integration proof.

## Patterns Established

**Dry-run-first operational scripts:** `--dry-run` is the default; `--no-dry-run` is required for mutations. Required args (`--owner`, `--repo`, `--issue-number`) exit 1 with `ERROR: <flag> is required` if missing. `--issue-number` is validated as a positive integer via `parseInt` + strict string round-trip check.

**Comment classification by marker:** `hasModificationMarker(body)` checks for `<!-- kodiai:wiki-modification:` substring. Default mode targets absence of marker (garbage non-marked comments); `--delete-all` targets all. This pattern can be reused for future issue cleanup scripts targeting different marker namespaces.

**Auth skeleton:** Ported verbatim from `cleanup-legacy-branches.ts` — `loadPrivateKey`, `AppConfig` stub, `createGitHubApp`, `getRepoInstallationContext`. Any future operational script that needs GitHub App auth should follow this exact pattern.

## Key Decisions

- `--repo` is required (unlike in `cleanup-legacy-branches.ts` where it is optional). Issue lookup always needs an explicit repo — making it optional would create a silent failure mode.
- Manual page loop instead of `paginate.iterator` to match the existing `wiki-publisher.ts` pagination pattern and avoid iterator API inconsistencies across Octokit versions.

## What S04 Needs to Know

- The live dry-run (`--owner xbmc --repo wiki --issue-number 5 --dry-run`) will show how many non-marked comments exist before the actual deletion run.
- The actual deletion (`--no-dry-run`) should happen before `publish-wiki-updates.ts` so the re-publication starts from a clean state.
- The `--- Summary ---` block output is machine-auditable: grep for `Targets:`, `Deleted:`, `Errors:` lines.
- `LOG_LEVEL=debug` surfaces pagination and auth internals — useful if the app installation isn't found for the owner/repo combination.
