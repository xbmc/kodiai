---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T02: Wire upsert, fork detection, and Dockerfile into handler

Update `src/handlers/addon-check.ts` with three changes:\n\n1. **Fork detection** — follow `review.ts` lines 1168–1195. Read `payload.pull_request.head.repo`. Set `isFork = Boolean(headRepo && headRepo.full_name !== repo)` and `isDeletedFork = !headRepo`. In the job: if fork/deleted-fork, call `workspaceManager.create(installationId, { owner, repo: repoName, ref: baseBranch })` then `fetchAndCheckoutPullRequestHeadRef({ dir: workspace.dir, prNumber, localBranch: 'pr-check' })`; else `workspaceManager.create(installationId, { owner, repo: repoName, ref: headRef })`. Import `fetchAndCheckoutPullRequestHeadRef` from `../jobs/workspace.ts`.\n\n2. **Upsert comment** — add an inline async helper `upsertAddonCheckComment({ octokit, owner, repo, prNumber, body })` inside the handler file (not exported). It: calls `octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100 })`, finds an existing comment whose body includes `buildAddonCheckMarker(owner, repo, prNumber)`, then calls `updateComment` or `createComment`. After the per-addon loop, call `upsertAddonCheckComment` with `formatAddonCheckComment(allFindings, buildAddonCheckMarker(owner, repo, prNumber))`. Do NOT call upsert if every addon returned `toolNotFound: true` (i.e., skip when `allFindings.length === 0 && toolNotFoundCount === addonIds.length`). Import `buildAddonCheckMarker, formatAddonCheckComment` from `../lib/addon-check-formatter.ts`.\n\n3. **Tests** — extend `src/handlers/addon-check.test.ts` with 4 new tests. The mock octokit needs `rest.issues.listComments`, `rest.issues.createComment`, `rest.issues.updateComment` added (create a new `createMockOctokitWithIssues(files, existingComments)` helper that adds these methods). Tests:\n   - `posts comment when findings exist`: octokit has no existing comments; after handler runs, `createComment` called once with body containing the marker and an ERROR row.\n   - `no comment posted when no findings and tool not found`: all addons return `toolNotFound: true`; `createComment` NOT called.\n   - `updates existing comment on second push (upsert path)`: octokit returns one existing comment whose body contains the marker; `updateComment` called once, `createComment` NOT called.\n   - `fork PR uses base branch + fetchAndCheckoutPullRequestHeadRef`: payload has `head.repo.full_name !== repository.full_name`; `workspaceManager.create` called with `ref: baseBranch`; inject `__fetchAndCheckoutForTests` (see below).\n\nFor fork test: add optional `__fetchAndCheckoutForTests?: typeof fetchAndCheckoutPullRequestHeadRef` parameter to `createAddonCheckHandler` deps, used in the same place as the real import. This avoids needing to mock the module.\n\n4. **Dockerfile** — change the apt line to:\n```\nRUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pip && pip3 install --no-cache-dir kodi-addon-checker && rm -rf /var/lib/apt/lists/*\n```\n\n5. **Verify TypeScript** — run `bun run tsc --noEmit` and fix any errors introduced.

## Inputs

- `src/handlers/addon-check.ts`
- `src/handlers/addon-check.test.ts`
- `src/lib/addon-check-formatter.ts`
- `src/jobs/workspace.ts`
- `Dockerfile`

## Expected Output

- `src/handlers/addon-check.ts`
- `src/handlers/addon-check.test.ts`
- `Dockerfile`

## Verification

bun test src/handlers/addon-check.test.ts && bun run tsc --noEmit
