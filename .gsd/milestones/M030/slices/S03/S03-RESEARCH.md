# S03: PR comment posting and idempotency — Research

**Date:** 2026-03-28

## Summary

S03 is the final slice of M030 and is mostly wiring: take the structured `AddonFinding[]` that S02 already collects in `allFindings` and (1) format them into a PR comment body, (2) post or update the comment idempotently using an HTML marker, (3) handle fork PRs correctly (clone base + `fetchAndCheckoutPullRequestHeadRef`), and (4) update the Dockerfile with Python 3 + `kodi-addon-checker`.

The comment marker pattern, the upsert logic, and the formatter style are all established. `src/triage/triage-comment.ts` shows the canonical compact formatter + marker pattern. `src/handlers/review.ts` (`upsertReviewDetailsComment`) shows the canonical "list PR comments, find by marker, update or create" upsert pattern. The addon-check handler already has `octokit` in scope and the `allFindings` accumulator is already built. The work is: add a formatter module, add an upsert call at the end of the job, handle fork detection, and update the Dockerfile.

No novel technology, no ambiguous requirements, no library research needed. Everything needed is already in the codebase.

## Recommendation

Build in this order:
1. **`src/lib/addon-check-formatter.ts`** — pure module: `buildAddonCheckMarker(owner, repo, prNumber)` and `formatAddonCheckComment(findings, marker)`. Unit test it standalone. Pure function, no I/O, easy to test first.
2. **Update `src/handlers/addon-check.ts`** — add fork detection, upsert comment call, import formatter. The handler already accumulates `allFindings`; add one `upsertAddonCheckComment` call after the per-addon loop.
3. **Dockerfile** — add `python3-pip` + `pip install kodi-addon-checker` to the existing Debian stage.

The formatter and upsert logic should be a standalone helper (not inlined in the handler) so it can be tested independently.

## Implementation Landscape

### Key Files

- `src/handlers/addon-check.ts` — The handler to extend. Currently accumulates `allFindings` and logs them. Needs: fork detection (lines from review.ts pattern), and a post-loop upsert call. The `octokit` variable is already in scope (from `githubApp.getInstallationOctokit`). `sanitizeOutgoingMentions` and `githubApp.getAppSlug()` are the bot-handle pattern used in review.ts.
- `src/lib/addon-check-formatter.ts` — **New file.** Pure formatter: marker builder and comment body formatter. Follow `src/triage/triage-comment.ts` structure: marker constant + two exports.
- `src/handlers/addon-check.test.ts` — Extend with ~4 new tests: comment posted when findings exist, no comment when no findings + no tool-not-found, comment updated (not duplicated) on second push (upsert path), fork PR uses `fetchAndCheckoutPullRequestHeadRef`. All existing 11 tests must continue to pass.
- `src/lib/addon-check-formatter.test.ts` — **New file.** Unit tests for formatter and marker.
- `Dockerfile` — Add Python 3 + pip install after the `git ca-certificates` apt line.
- `src/jobs/workspace.ts` — `fetchAndCheckoutPullRequestHeadRef` is already exported here; import it in the handler.

### Idempotency Pattern (exact approach from `upsertReviewDetailsComment`)

```ts
async function upsertAddonCheckComment(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}): Promise<void> {
  const { octokit, owner, repo, prNumber, body } = params;
  const marker = buildAddonCheckMarker(owner, repo, prNumber);

  const { data: comments } = await octokit.rest.issues.listComments({
    owner, repo, issue_number: prNumber, per_page: 100,
  });
  const existing = comments.find(c => typeof c.body === "string" && c.body.includes(marker));

  if (existing) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  }
}
```

The marker should be unique to this handler: `<!-- kodiai:addon-check:{owner}/{repo}:{prNumber} -->`.

### Comment Format

Follow the style from `src/triage/triage-comment.ts` (compact markdown table) and the M030-CONTEXT note "same style as existing reviews — severity, message, addon ID":

```
<!-- kodiai:addon-check:{owner}/{repo}:{prNumber} -->
## Kodiai Addon Check

| Addon | Level | Message |
|-------|-------|---------|
| plugin.video.foo | ERROR | missing changelog |
| plugin.video.foo | WARN  | icon too large    |

_X error(s), Y warning(s) found._
```

If no findings: post a clean pass comment:
```
## Kodiai Addon Check

✅ No issues found by kodi-addon-checker.
```

Context says INFO findings can be omitted (CONTEXT.md open question answer: "post both [ERROR and WARN], clearly distinguished; INFO can be omitted"). The formatter should filter INFO from the rendered table but count only ERRORs and WARNs in the summary line.

### Fork PR Handling

Follow review.ts lines 1168–1195 exactly:
```ts
const headRepo = payload.pull_request?.head.repo;
const isFork = Boolean(headRepo && headRepo.full_name !== repo);
const isDeletedFork = !headRepo;

if (isFork || isDeletedFork) {
  workspace = await workspaceManager.create(installationId, { owner, repo: repoName, ref: baseBranch });
  await fetchAndCheckoutPullRequestHeadRef({ dir: workspace.dir, prNumber, localBranch: "pr-check" });
} else {
  workspace = await workspaceManager.create(installationId, { owner, repo: repoName, ref: headRef });
}
```

The handler payload shape already includes `head.repo` in the cast — just needs to be read.

### Dockerfile Update

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates python3 python3-pip \
    && pip3 install --no-cache-dir kodi-addon-checker \
    && rm -rf /var/lib/apt/lists/*
```

The existing Dockerfile uses `oven/bun:1-debian` which is Debian-based; `python3` and `python3-pip` are available in the default repos. `kodi-addon-checker` is on PyPI.

### Verification Commands

```
bun test src/lib/addon-check-formatter.test.ts    # formatter unit tests
bun test src/handlers/addon-check.test.ts          # all 15+ handler tests pass
bun run tsc --noEmit                               # exit 0
```

### Build Order

1. **T01** — `src/lib/addon-check-formatter.ts` + `src/lib/addon-check-formatter.test.ts`: pure formatter, testable in isolation, zero handler risk.
2. **T02** — Update `src/handlers/addon-check.ts`: add fork detection + `upsertAddonCheckComment` call; extend `src/handlers/addon-check.test.ts` with ~4 new tests covering the upsert path, no-findings path, and fork path. Update Dockerfile. Run `bun run tsc --noEmit` to confirm exit 0.
