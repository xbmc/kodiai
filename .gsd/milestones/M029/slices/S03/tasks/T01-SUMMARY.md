---
id: T01
parent: S03
milestone: M029
provides:
  - scripts/cleanup-wiki-issue.ts — dry-run-safe one-shot script for deleting issue comments by marker scan
key_files:
  - scripts/cleanup-wiki-issue.ts
key_decisions:
  - Ported auth/arg/env skeleton verbatim from cleanup-legacy-branches.ts to maintain pattern consistency
  - Manual page loop (not paginate.iterator) for comment listing, matching wiki-publisher.ts pattern
  - issue-number validated as a positive integer via parseInt + strict string round-trip check
patterns_established:
  - Dry-run-first operational scripts: --dry-run default, --no-dry-run required for mutations
  - Comment classification: presence/absence of <!-- kodiai:wiki-modification: marker determines target set
observability_surfaces:
  - "[DRY RUN]/[DELETED]/[FAILED] prefixed per-comment lines to stdout (grep-able)"
  - "--- Summary --- block at every exit with total/targets/deleted/errors counts"
  - "LOG_LEVEL=debug bun scripts/cleanup-wiki-issue.ts --dry-run surfaces auth + pagination internals"
duration: 20m
verification_result: passed
completed_at: 2026-03-21T23:10:00Z
blocker_discovered: false
---

# T01: Write cleanup-wiki-issue.ts script

**Created `scripts/cleanup-wiki-issue.ts` — a dry-run-safe issue comment cleanup script that lists and deletes comments lacking the `<!-- kodiai:wiki-modification:` marker, with paginated listing, `--delete-all` override, and a summary block on every run.**

## What Happened

Read `scripts/cleanup-legacy-branches.ts` and `src/knowledge/wiki-publisher.ts` as reference files, then applied the pre-flight observability gap fixes to S03-PLAN.md and T01-PLAN.md before writing code.

Ported the skeleton (imports, `loadPrivateKey`, `AppConfig` stub, app init, env validation) verbatim from `cleanup-legacy-branches.ts`. Adapted argument parsing to add `--issue-number` (required string, validated as positive integer) and `--delete-all` (boolean). Added `--repo` as a required arg (the branch script treats it as optional, but issue lookup always needs an explicit repo).

Implemented `hasModificationMarker` to check for the `<!-- kodiai:wiki-modification:` string. Default mode targets comments that lack the marker; `--delete-all` targets all comments. Paginated listing follows the manual `for (let page = 1; ; page++)` pattern from `wiki-publisher.ts` rather than `paginate.iterator`.

Output format uses `[DRY RUN]`/`[DELETED]`/`[FAILED]` prefixed lines with comment ID, reason, and body snippet. A `--- Summary ---` block is always printed.

TypeScript check via `bunx tsc --noEmit` confirmed zero errors in `cleanup-wiki-issue.ts`. (Pre-existing errors exist in other scripts/files in the worktree — none introduced by this task.)

## Verification

All four task verification checks passed:

1. `--help` exits 0 and prints full usage including all flags ✅
2. `bunx tsc --noEmit` (scoped to cleanup-wiki-issue.ts) — zero errors ✅
3. Missing `--issue-number` exits 1 with `ERROR: --issue-number is required` ✅
4. `--issue-number abc` exits 1 with `ERROR: --issue-number must be a positive integer` ✅
5. Missing `--owner` exits 1 with `ERROR: --owner is required` ✅
6. Missing `--repo` exits 1 with `ERROR: --repo is required` ✅

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun scripts/cleanup-wiki-issue.ts --help` | 0 | ✅ pass | <1s |
| 2 | `bunx tsc --noEmit 2>&1 \| grep cleanup-wiki-issue` | (no output = no errors) | ✅ pass | ~15s |
| 3 | `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki` | 1 | ✅ pass | <1s |
| 4 | `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number abc` | 1 | ✅ pass | <1s |
| 5 | `bun scripts/cleanup-wiki-issue.ts --repo wiki --issue-number 5` | 1 | ✅ pass | <1s |
| 6 | `bun scripts/cleanup-wiki-issue.ts --owner xbmc --issue-number 5` | 1 | ✅ pass | <1s |

Slice-level verification:
- `bun scripts/cleanup-wiki-issue.ts --help` exits 0 ✅
- TypeScript check passes ✅
- Manual live dry-run (`--owner xbmc --repo wiki --issue-number 5 --dry-run`) requires `GITHUB_APP_ID`+`GITHUB_PRIVATE_KEY` — deferred to S04 execution step per plan
- Failure-path check (`--owner xbmc --repo wiki` exits 1 with `ERROR: --issue-number is required`) ✅

## Diagnostics

- `bun scripts/cleanup-wiki-issue.ts --help` — shows all flags and marker format
- `LOG_LEVEL=debug bun scripts/cleanup-wiki-issue.ts --owner X --repo R --issue-number N --dry-run 2>&1` — surfaces auth init and per-page pagination details without mutating state
- Exit 1 + `ERROR:` prefix for: missing `--owner`, `--repo`, `--issue-number`; invalid `--issue-number`; missing env vars; no installation found for owner/repo
- `[DRY RUN]`/`[DELETED]`/`[FAILED]` lines are grep-able by prefix
- `--- Summary ---` block always present at exit — machine-parseable counts

## Deviations

`--repo` is marked required (exits 1 if missing), whereas the template script `cleanup-legacy-branches.ts` treats it as optional. The issue context always requires a specific repo, so making it required is correct. This is an intentional adaptation, not a deviation from the task plan (T01-PLAN.md requires `--repo` validation).

## Known Issues

None. Pre-existing TypeScript errors in other scripts (`embedding-repair.ts`, `retriever-verify.ts`, etc.) are unrelated to this task.

## Files Created/Modified

- `scripts/cleanup-wiki-issue.ts` — new one-shot operational script (~220 lines), dry-run-safe, TypeScript-clean
- `.gsd/milestones/M029/slices/S03/S03-PLAN.md` — added Observability/Diagnostics section and failure-path verification step (pre-flight gap fix)
- `.gsd/milestones/M029/slices/S03/tasks/T01-PLAN.md` — added Observability Impact section (pre-flight gap fix)
