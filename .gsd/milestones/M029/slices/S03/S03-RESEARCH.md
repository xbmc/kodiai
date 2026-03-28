# S03 Research — Issue Cleanup Script

**Slice:** S03 | risk: low | depends: [S01, S02]
**Date:** 2026-03-21

## Summary

S03 is a straight port of the `cleanup-legacy-branches.ts` pattern onto a new target: GitHub issue comments. The approach, auth, argument parsing, and dry-run design are all established — nothing novel. The only deliverable is `scripts/cleanup-wiki-issue.ts`. The work is 1 file, ~200 lines, no new dependencies, no DB, no test files (verification class is manual execution per the roadmap).

**Verdict:** Light research. Confirmed pattern is copy-paste with adapted logic. No risks beyond requiring live GitHub auth for the read step.

---

## Implementation Landscape

### Primary template: `scripts/cleanup-legacy-branches.ts`

This file is the exact structural template for S03. Copy every section verbatim; adapt only the business logic:

| Section | cleanup-legacy-branches.ts | cleanup-wiki-issue.ts |
|---|---|---|
| Imports | `parseArgs`, `pino`, `createGitHubApp`, `AppConfig` | Same |
| Arg parsing | `--owner`, `--repo`, `--dry-run`, `--no-dry-run`, `--help` | Same + `--issue-number`, `--delete-all` |
| Private key load | `loadPrivateKey()` → inline PEM / file path / base64 | Same — copy verbatim |
| Env validation | `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` | Same |
| `AppConfig` stub | All required fields with `"unused"` for non-GitHub fields | Same — use `satisfies AppConfig` |
| App init | `createGitHubApp(appConfig, logger)` → `initialize()` | Same |
| Installation context | `getRepoInstallationContext(owner, repo)` | Same |
| Octokit | `getInstallationOctokit(installationId)` | Same |
| Dry-run default | `const dryRun = !values["no-dry-run"]` | Same |

**No new dependencies** — `@octokit/rest` and `@octokit/auth-app` are already installed.

### GitHub API calls needed

**List comments** (already used in `wiki-publisher.ts`, lines 186–203):
```typescript
octokit.rest.issues.listComments({
  owner, repo, issue_number: issueNumber,
  per_page: 100, page, sort: "created", direction: "asc"
})
```
Paginate with a `for (let page = 1; ...; page++)` loop as in `wiki-publisher.ts`. Stop when `data.length === 0` or `data.length < 100`.

**Delete comment** — confirmed in `@octokit/plugin-rest-endpoint-methods` type definitions:
```typescript
octokit.rest.issues.deleteComment({
  owner, repo, comment_id: commentId
})
```
Maps to `DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}`. This is the only mutation call.

### Comment classification

Two distinct GitHub objects exist on the issue:

1. **Issue body** — the summary table rendered by `formatSummaryTable()` (starts with `# Wiki Modification Artifacts —`). This is the **issue body**, not a comment. `listComments()` does NOT return it. Zero risk of accidentally deleting it.

2. **Issue comments** — what `listComments()` returns:
   - Legitimate marker comments: contain `<!-- kodiai:wiki-modification:{pageId} -->` (from `formatPageComment()`, line 38 in `wiki-publisher.ts`)
   - Garbage comments: everything else (reasoning prose, human complaints, legacy non-marker comments)

**Classification logic:**
```typescript
function hasModificationMarker(body: string): boolean {
  return body.includes("<!-- kodiai:wiki-modification:");
}
```

**Deletion targets:**
- Default mode (no flags): delete comments that do NOT have the marker
- `--delete-all`: delete ALL comments regardless of marker

**Flag rationale:** The roadmap requires deleting both (a) old garbage comments from before the marker system (IDs 4044181807–4049128966 — pre-marker, no `<!-- kodiai:wiki-modification: -->`) and (b) new marker comments with garbage reasoning prose content (IDs 4071499246–4071616057 — have the marker but contain bad content). `--delete-all` handles case (b) — used before re-generation/re-publication so the re-publication can post fresh clean comments.

### Argument interface

```
bun scripts/cleanup-wiki-issue.ts \
  --owner xbmc --repo wiki --issue-number 5 --dry-run

bun scripts/cleanup-wiki-issue.ts \
  --owner xbmc --repo wiki --issue-number 5 --no-dry-run

bun scripts/cleanup-wiki-issue.ts \
  --owner xbmc --repo wiki --issue-number 5 --delete-all --no-dry-run
```

Required arguments: `--owner`, `--repo`, `--issue-number`.
Script exits 1 with a clear error if any are missing.

### Output format

Print one line per comment in a plain-text table:
```
[DRY RUN] would delete comment 4044181807 (no marker) body_snippet="I'll analyze the evidence..."
[DELETED]  comment 4044181807
[FAILED]   comment 4044181807: <error message>
```

Summary at end:
```
--- Summary ---
Total comments found: 47
Deletion targets: 12
Deleted: 12 (or Would delete: 12 if dry-run)
Errors: 0
```

JSON output is NOT required by the roadmap — plain text table is sufficient for audit.

### AppConfig minimal stub (exact pattern from `cleanup-legacy-branches.ts`, lines 112–135)

```typescript
const appConfig = {
  githubAppId: process.env.GITHUB_APP_ID!,
  githubPrivateKey: privateKey,
  webhookSecret: "unused",
  slackSigningSecret: "unused",
  slackBotToken: "unused",
  slackBotUserId: "unused",
  slackKodiaiChannelId: "unused",
  slackDefaultRepo: "unused",
  slackAssistantModel: "unused",
  port: 3000,
  logLevel: "info",
  botAllowList: [],
  slackWikiChannelId: "",
  wikiStalenessThresholdDays: 30,
  wikiGithubOwner: "",
  wikiGithubRepo: "",
  botUserPat: "",
  botUserLogin: "",
} satisfies AppConfig;
```

### Rate limiting

Issue comments are not subject to GitHub secondary rate limits the way PR creation is. A simple sequential delete loop with no delay is fine for the expected comment count (~50 or fewer). If rate limiting is a concern later, add a small `await delay(200)` between deletes. Not needed for the initial implementation.

### Verification class (from roadmap)

> "Dry-run mode can be validated without GitHub auth. Live --no-dry-run requires real credentials — executed manually as part of S04 integration."

In practice: the **dry-run flag prevents mutations** but the script still needs GitHub auth to list comments (read is still an API call). The "without GitHub auth" claim means the script's internal logic — argument validation, classification, output formatting — can be exercised in tests without hitting GitHub. The CLI dry-run itself requires live credentials.

No test file is expected for S03 (verification class: manual execution). If tests are written, mock the octokit calls directly (same pattern as `wiki-publisher.test.ts`).

---

## File to Create

**`scripts/cleanup-wiki-issue.ts`** — ~200 lines

No other files change for S03.

---

## Forward Intelligence for Planner/Executor

- **Do NOT use `satisfies AppConfig` if the type won't resolve** — check that `import type { AppConfig } from "../src/config.ts"` resolves. It does: confirmed in both cleanup-legacy-branches.ts (line 20) and publish-wiki-updates.ts (line 29).
- **`getRepoInstallationContext(owner, repo)` can return null** — handle with `console.error + process.exit(1)` exactly as in cleanup-legacy-branches.ts (lines 144–148).
- **listComments pagination**: use the manual page loop (same as wiki-publisher.ts), not `paginate.iterator` — the iterator pattern requires type-safe method signatures that are trickier than the simple loop.
- **The issue body (summary table) is NOT in listComments output** — no special handling needed to protect it.
- **`--delete-all` should still skip if the comment belongs to the issue system** (GitHub creates synthetic "referenced" events, but these don't appear in `listComments` — only actual user/bot comments appear).
- **Env var loading**: support both `GITHUB_PRIVATE_KEY` and `GITHUB_PRIVATE_KEY_BASE64` — see lines 55–62 in `cleanup-legacy-branches.ts` for the pattern. The `loadPrivateKey()` helper is copy-paste safe.
- **Issue number must be a positive integer**: validate with `parseInt` and check `isNaN` — same pattern as publish-wiki-updates.ts lines 89–93.
