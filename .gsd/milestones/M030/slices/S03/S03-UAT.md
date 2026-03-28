# S03: PR comment posting and idempotency — UAT

**Milestone:** M030
**Written:** 2026-03-28T16:23:09.326Z

# S03 UAT: PR Comment Posting and Idempotency

## Preconditions

- Kodiai server running with `addonRepos` config including `xbmc/repo-plugins`
- `kodi-addon-checker` installed in the container (`pip3 install kodi-addon-checker`)
- GitHub App authenticated with write access to PR comments on the target repo
- Test PR open against `xbmc/repo-plugins` on a Kodi-named branch (e.g., `nexus`)

---

## Test Cases

### TC-01: Fresh PR with violations posts a new comment

**Preconditions:** PR has files under an addon directory (`plugin.video.foo/`) with at least one ERROR or WARN finding from kodi-addon-checker. No prior Kodiai addon-check comment on the PR.

**Steps:**
1. Open a PR (or trigger `pull_request.opened` webhook) against `xbmc/repo-plugins`
2. Wait for Kodiai to process the event

**Expected:**
- A new PR comment is posted by the Kodiai bot
- Comment body starts with `<!-- kodiai:addon-check:xbmc/repo-plugins:{prNumber} -->`
- Comment contains `## Kodiai Addon Check` heading
- Comment contains a markdown table with columns `Addon | Level | Message`
- ERROR and WARN rows are present; INFO rows are absent
- Summary line reads `_X error(s), Y warning(s) found._` with correct counts

---

### TC-02: Clean addon produces a "no issues found" comment

**Preconditions:** PR touches an addon directory but kodi-addon-checker finds no ERROR or WARN findings (only INFO or nothing).

**Steps:**
1. Open a PR with a clean addon
2. Wait for Kodiai to process

**Expected:**
- Comment is posted with `✅ No issues found by kodi-addon-checker.`
- No markdown table present in the comment body
- Summary count line absent

---

### TC-03: Re-push to same PR updates existing comment (upsert — no duplicate)

**Preconditions:** TC-01 has already run; the Kodiai addon-check comment exists on the PR.

**Steps:**
1. Push a new commit to the same PR branch
2. Wait for `pull_request.synchronize` event to be processed

**Expected:**
- No new comment is created
- The existing Kodiai addon-check comment is updated in place (timestamp changes, content reflects latest findings)
- `updateComment` called, `createComment` not called (verifiable via server logs)

---

### TC-04: Fork PR clones base branch then overlays head ref

**Preconditions:** PR opened from a forked repository (`head.repo.full_name !== base.repo.full_name`).

**Steps:**
1. Open a PR from a fork targeting `xbmc/repo-plugins`
2. Wait for handler to process

**Expected:**
- `workspaceManager.create` called with `ref: baseBranch` (not the fork's head ref)
- `fetchAndCheckoutPullRequestHeadRef` called to overlay the fork's changes
- Addon check proceeds normally; comment posted as per TC-01 or TC-02

---

### TC-05: Checker binary absent — no comment posted

**Preconditions:** `kodi-addon-checker` is not installed in the container (binary missing from PATH).

**Steps:**
1. Trigger a `pull_request.opened` event for an addon repo PR
2. Wait for handler to process

**Expected:**
- Handler runs without crashing
- No PR comment is posted (upsert entirely skipped)
- Server logs show per-addon warnings about the tool not being found

---

### TC-06: Non-addon repo — handler silently skips

**Preconditions:** Webhook event comes from a repo NOT in `addonRepos` config.

**Steps:**
1. Open a PR against any non-addon repo
2. Confirm the event reaches Kodiai

**Expected:**
- Handler returns immediately with no workspace creation, no runner calls, no comment posted

---

### TC-07: Unit test smoke — formatter module

**Steps:**
```bash
bun test src/lib/addon-check-formatter.test.ts
```

**Expected:** 11 pass, 0 fail

---

### TC-08: Unit test smoke — handler integration

**Steps:**
```bash
bun test src/handlers/addon-check.test.ts
```

**Expected:** 15 pass, 0 fail (includes posts-comment, skip-on-toolNotFound, upsert-path, fork-path tests)

---

### TC-09: TypeScript type-check

**Steps:**
```bash
bun run tsc --noEmit
```

**Expected:** Exit 0, no output

