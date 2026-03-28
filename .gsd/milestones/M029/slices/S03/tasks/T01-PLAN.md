---
estimated_steps: 5
estimated_files: 1
skills_used: []
---

# T01: Write cleanup-wiki-issue.ts script

**Slice:** S03 — Issue Cleanup Script
**Milestone:** M029

## Description

Create `scripts/cleanup-wiki-issue.ts` — a dry-run-safe one-time operational script that lists and deletes comments from a GitHub issue by marker scan. This is a direct port of `scripts/cleanup-legacy-branches.ts` with adapted business logic: instead of scanning branches, it lists issue comments via `octokit.rest.issues.listComments` and deletes targets via `octokit.rest.issues.deleteComment`.

The script is the only deliverable for S03. It must be safe by default (dry-run), structured enough to audit before running live, and ready for S04 integration where it will be executed with `--no-dry-run` to clean issue #5 before re-publication.

## Steps

1. **Copy the skeleton from `cleanup-legacy-branches.ts`**: imports (`parseArgs`, `pino`, `createGitHubApp`, `AppConfig`), `loadPrivateKey()` helper, `AppConfig` stub with `satisfies AppConfig`, app init pattern, env validation. Change nothing structural — copy verbatim.

2. **Adapt argument parsing**: add `--issue-number` (required, string) and `--delete-all` (boolean, default false) to the `parseArgs` options. Keep `--owner`, `--repo`, `--dry-run`, `--no-dry-run`, `--help`. Validate that `--owner`, `--repo`, and `--issue-number` are all present and that `--issue-number` parses as a positive integer — exit 1 with clear error for each missing/invalid arg.

3. **Implement comment classification**:
   ```typescript
   function hasModificationMarker(body: string): boolean {
     return body.includes("<!-- kodiai:wiki-modification:");
   }
   ```
   Default mode (no `--delete-all`): target comments that do NOT have the marker.
   `--delete-all` mode: target ALL comments regardless of marker.

4. **Implement paginated comment listing**: use a manual page loop (same pattern as `wiki-publisher.ts`, not `paginate.iterator`) to collect all comments from the issue:
   ```typescript
   for (let page = 1; ; page++) {
     const { data } = await octokit.rest.issues.listComments({
       owner, repo, issue_number: issueNumber,
       per_page: 100, page, sort: "created", direction: "asc"
     });
     if (data.length === 0) break;
     allComments.push(...data);
     if (data.length < 100) break;
   }
   ```

5. **Implement deletion loop with output format**: for each target comment, print one line and optionally delete:
   - Dry-run: `[DRY RUN] would delete comment {id} ({reason}) body_snippet="{first 80 chars}"`
   - Delete: `[DELETED]  comment {id}` or `[FAILED]   comment {id}: {error}`
   
   Print summary block at end:
   ```
   --- Summary ---
   Total comments found: N
   Deletion targets: N
   Deleted: N  (or Would delete: N if dry-run)
   Errors: N
   ```

## Must-Haves

- [ ] Script compiles: `bun --check scripts/cleanup-wiki-issue.ts` exits 0
- [ ] `--help` exits 0 and prints usage including all flags
- [ ] Missing `--owner` → exits 1 with "ERROR: --owner is required"
- [ ] Missing `--repo` → exits 1 with "ERROR: --repo is required"
- [ ] Missing `--issue-number` → exits 1 with "ERROR: --issue-number is required"
- [ ] Invalid `--issue-number` (non-integer) → exits 1
- [ ] Default mode: targets comments WITHOUT `<!-- kodiai:wiki-modification:` marker
- [ ] `--delete-all` mode: targets ALL comments
- [ ] `--dry-run` is default (no mutations unless `--no-dry-run` is explicitly passed)
- [ ] Auth follows `cleanup-legacy-branches.ts` exactly: `createGitHubApp` → `initialize()` → `getRepoInstallationContext` → `getInstallationOctokit`
- [ ] `getRepoInstallationContext` null result → exits 1 with clear error
- [ ] Summary block printed at end of every run

## Observability Impact

- **New stdout signals**: `[DRY RUN] would delete comment {id}`, `[DELETED] comment {id}`, `[FAILED] comment {id}: {error}` — all grep-able by tag prefix.
- **Summary block always printed**: `--- Summary ---` with total/targets/deleted/errors counts appears at every exit, giving a machine-parseable audit trail.
- **pino log at `info`**: Auth initialization and pagination events logged via pino; `LOG_LEVEL=debug` exposes per-page API call details.
- **Failure state**: Missing required args → `ERROR:` prefix + exit 1; auth failure → `ERROR: No GitHub App installation found for {owner}` + exit 1.
- **Inspection command**: `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run` with valid env vars prints full comment inventory without mutations.
- **No new metrics, traces, or persisted state** — this is a one-shot operational script.

## Verification

- `bun --check scripts/cleanup-wiki-issue.ts` exits 0
- `bun scripts/cleanup-wiki-issue.ts --help` exits 0 and prints usage text
- `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki` exits 1 with error about missing `--issue-number`
- `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number abc` exits 1 with error about invalid issue number

## Inputs

- `scripts/cleanup-legacy-branches.ts` — structural template to port (auth pattern, arg parsing, env validation, loadPrivateKey, AppConfig stub)
- `src/knowledge/wiki-publisher.ts` — reference for `listComments` pagination pattern (lines ~186–203) and the marker format `<!-- kodiai:wiki-modification:{pageId} -->`
- `src/auth/github-app.ts` — confirms `createGitHubApp`, `getRepoInstallationContext`, `getInstallationOctokit` API
- `src/config.ts` — confirms `AppConfig` import path

## Expected Output

- `scripts/cleanup-wiki-issue.ts` — new script, ~200 lines, TypeScript-clean, dry-run safe
