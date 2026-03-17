---
estimated_steps: 7
estimated_files: 4
---

# T01: Wire `--issue-number` to Live Publish Path

**Slice:** S03 — Live Modification-Only Wiki Publishing
**Milestone:** M028

## Description

Currently, `--issue-number` in `scripts/publish-wiki-updates.ts` is only parsed inside the `if (retrofitPreview)` block. When a live publish runs without `--retrofit-preview`, the publisher always calls `octokit.rest.issues.create()` to spawn a new tracking issue. S03 needs the publisher to target an existing issue when `--issue-number` is supplied, skipping `issues.create` entirely and using the supplied number directly.

**What already exists (from S02):**

- `PublishRunOptions.issueNumber?: number` — field is already typed; currently only used by the `retrofitPreview` branch inside `publish()`
- `scripts/publish-wiki-updates.ts` parses `--issue-number` into `retrofitIssueNumber` — but only inside `if (retrofitPreview) { ... }`
- The publisher's live path (step 5) unconditionally calls `octokit.rest.issues.create()` with the title `"Wiki Update Suggestions — {date}"`

**What this task adds:**

1. Move `--issue-number` parsing outside the `retrofitPreview` gate so the CLI accepts it for all run modes.
2. Pass the parsed value to `publisher.publish({ issueNumber: liveIssueNumber })` unconditionally.
3. In `wiki-publisher.ts publish()`, just before step 5, branch on `runOptions.issueNumber`: if provided (and not `retrofitPreview`), skip `issues.create`, use the supplied `issueNumber`, and fetch `issueUrl` via `octokit.rest.issues.get()`.
4. Update the new-issue title from `"Wiki Update Suggestions"` to `"Wiki Modification Artifacts"` (for any newly-created issues going forward — the old title was part of the suggestion-style contract).
5. Update the CLI printed summary to distinguish "supplied" vs "created" issue.
6. Add a publisher test for the supplied-`issueNumber` path.

## Steps

1. **Edit `scripts/publish-wiki-updates.ts`**: move the `--issue-number` parsing block outside the `if (retrofitPreview)` block. The variable rename: use `liveIssueNumber` (or reuse `retrofitIssueNumber`) for the parsed integer; it applies to both retrofit-preview and live publish. Update the `--issue-number` help text to reflect that it also applies to live publish (not just `--retrofit-preview`). Pass `issueNumber: liveIssueNumber` to `publisher.publish()` unconditionally.

2. **Edit `scripts/publish-wiki-updates.ts`**: also ensure the GitHub App is initialized when `--issue-number` is provided without `--dry-run`. Currently the condition is `if (!dryRun || retrofitPreview)` — extend to `if (!dryRun || retrofitPreview || liveIssueNumber != null)` (though for a live non-dry-run without `retrofitPreview`, `!dryRun` already covers it; confirm the logic is correct).

3. **Edit `src/knowledge/wiki-publisher.ts`**: in `publish()`, replace the unconditional step 5 (`issues.create`) with a branch:
   ```
   if (runOptions.issueNumber) {
     // Supplied issue — no create, fetch issueUrl
     const issueData = await octokit!.rest.issues.get({ owner, repo, issue_number: runOptions.issueNumber });
     issueNumber = runOptions.issueNumber;
     issueUrl = issueData.data.html_url;
     logger.info({ issueNumber, issueUrl }, `Using supplied tracking issue #${issueNumber}`);
   } else {
     // Create new tracking issue (PUB-01)
     const today = new Date().toISOString().slice(0, 10);
     const issue = await octokit!.rest.issues.create({
       owner, repo,
       title: `Wiki Modification Artifacts — ${today}`,   // ← updated title
       body: "Posting modification artifacts... (will be updated with summary table)",
       labels: ["wiki-update", "bot-generated"],
     });
     issueNumber = issue.data.number;
     issueUrl = issue.data.html_url;
     logger.info({ issueNumber, issueUrl }, `Created tracking issue #${issueNumber}`);
   }
   ```
   Declare `issueNumber` and `issueUrl` as `let` before the branch so both paths can assign them.

4. **Update `src/knowledge/wiki-publisher-types.ts`**: update the JSDoc comment on `PublishRunOptions.issueNumber` to say it applies to both `retrofitPreview` AND live publish (not just `retrofitPreview`).

5. **Edit `scripts/publish-wiki-updates.ts`**: update the final printed summary. Add a line showing whether the issue was "supplied" or "created":
   - When `liveIssueNumber` was provided and not `dryRun`: print `Issue:   #${result.issueNumber} (supplied) — ${result.issueUrl}`
   - Otherwise (new issue created): print as before

6. **Add a publisher test in `src/knowledge/wiki-publisher.test.ts`**: add a test case for the supplied-`issueNumber` live publish path. The mock `octokit` should have:
   - `issues.get` — returns `{ data: { html_url: "https://github.com/xbmc/wiki/issues/5" } }`
   - `issues.create` — tracks whether it was called (should NOT be called)
   Verify: `issues.get` called with `issue_number: 5`; `issues.create` NOT called; the returned `PublishResult.issueNumber === 5`.

7. **Run verification**: `bun test src/knowledge/wiki-publisher.test.ts` → 38+ pass, 0 fail; `bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|publish-wiki'` → no output.

## Must-Haves

- [ ] `--issue-number <n>` is parsed unconditionally (outside `if (retrofitPreview)` block) in `scripts/publish-wiki-updates.ts`
- [ ] `publisher.publish({ ..., issueNumber: liveIssueNumber })` is called with the parsed value for all run modes
- [ ] `publish()` skips `octokit.rest.issues.create` and uses `octokit.rest.issues.get` when `runOptions.issueNumber` is provided and `retrofitPreview` is false
- [ ] New tracking issues (when no `--issue-number`) use the title `"Wiki Modification Artifacts — {date}"` not `"Wiki Update Suggestions — {date}"`
- [ ] Publisher test suite passes with ≥38 tests (37 existing + 1 new supplied-issueNumber test)
- [ ] Zero TypeScript errors on touched files

## Verification

```bash
bun test src/knowledge/wiki-publisher.test.ts
# → 38+ pass, 0 fail (including new supplied-issueNumber test)

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|publish-wiki'
# → (no output)

# Confirm CLI help shows --issue-number applies broadly
bun scripts/publish-wiki-updates.ts --help | grep issue-number
# → should not say "requires --retrofit-preview"
```

## Observability Impact

- Signals added: `logger.info({ issueNumber, issueUrl }, "Using supplied tracking issue #N")` logged when bypassing `issues.create`
- How a future agent inspects this: look for `"Using supplied tracking issue"` in logs; also check `result.issueNumber` matches supplied value
- Failure state exposed: if `issues.get` fails (404), the error propagates as a live publish failure — the operator will see an unhandled rejection; no special error handling needed for S03

## Inputs

- `scripts/publish-wiki-updates.ts` — CLI flag parsing, main(), publish() call site
- `src/knowledge/wiki-publisher.ts` — `publish()` implementation, step 5 (`issues.create`), `issueNumber` variable declaration
- `src/knowledge/wiki-publisher-types.ts` — `PublishRunOptions.issueNumber` JSDoc
- `src/knowledge/wiki-publisher.test.ts` — existing 37-test suite; `createMockOctokit()` helper

## Expected Output

- `scripts/publish-wiki-updates.ts` — `--issue-number` parsed outside `retrofitPreview` gate; `issueNumber` passed to `publish()` unconditionally
- `src/knowledge/wiki-publisher.ts` — branching step 5 that skips `issues.create` when `issueNumber` supplied; updated new-issue title
- `src/knowledge/wiki-publisher-types.ts` — updated `issueNumber` JSDoc
- `src/knowledge/wiki-publisher.test.ts` — 38+ tests with new supplied-`issueNumber` test
