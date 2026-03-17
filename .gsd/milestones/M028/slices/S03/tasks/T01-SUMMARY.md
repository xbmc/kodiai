---
id: T01
parent: S03
milestone: M028
provides:
  - "--issue-number wired to live publish path (outside retrofitPreview gate)"
  - "publisher.publish() skips issues.create and uses issues.get when issueNumber supplied"
  - "new tracking issues titled Wiki Modification Artifacts (not Wiki Update Suggestions)"
  - "CLI summary shows (supplied) vs (created) for issue number"
key_files:
  - scripts/publish-wiki-updates.ts
  - src/knowledge/wiki-publisher.ts
  - src/knowledge/wiki-publisher-types.ts
  - src/knowledge/wiki-publisher.test.ts
key_decisions:
  - "Renamed variable from retrofitIssueNumber to liveIssueNumber to reflect it now applies to all run modes"
  - "issueNumber and issueUrl declared as let before the branch so both paths can assign them"
  - "Updated issue creation title to 'Wiki Modification Artifacts' matching S03 naming"
patterns_established:
  - "Branch on runOptions.issueNumber before step 5 in publish(): supplied → issues.get, missing → issues.create"
observability_surfaces:
  - "logger.info({ issueNumber, issueUrl }, 'Using supplied tracking issue #N') when bypassing issues.create"
  - "CLI summary prints Issue: #N (supplied) — URL or #N (created) — URL"
duration: ~25m
verification_result: passed
completed_at: 2026-03-16
blocker_discovered: false
---

# T01: Wire `--issue-number` to live publish path

**Moved `--issue-number` CLI parsing outside the `retrofitPreview` gate and wired it through `publish()` so live runs can target an existing tracking issue instead of always calling `issues.create`.**

## What Happened

Four files were changed:

1. **`scripts/publish-wiki-updates.ts`**: Replaced the `retrofitPreview`-gated `--issue-number` parse block with a standalone parse into `liveIssueNumber`. The `retrofitPreview` validation now checks `liveIssueNumber == null` instead of parsing its own value. `publisher.publish()` receives `issueNumber: liveIssueNumber` unconditionally. The `--issue-number` help text was updated. The final CLI summary now prints `#N (supplied) — URL` when `liveIssueNumber` was provided, or `#N (created) — URL` when the publisher created a new issue.

2. **`src/knowledge/wiki-publisher.ts`**: Replaced the unconditional `issues.create` at step 5 with a branch: when `runOptions.issueNumber` is set, calls `octokit.rest.issues.get()` to fetch `issueUrl` and uses the supplied number directly; otherwise creates a new issue with the updated title `"Wiki Modification Artifacts — {date}"`. Both paths assign `issueNumber` and `issueUrl` as `let` before the branch.

3. **`src/knowledge/wiki-publisher-types.ts`**: Updated the `issueNumber` JSDoc on `PublishRunOptions` to document that it applies to both `retrofitPreview` and live publish.

4. **`src/knowledge/wiki-publisher.test.ts`**: Added `issues.get` mock to `createMockOctokit()`. Added new describe block `"supplied issueNumber — live publish to existing issue"` with one test that verifies: `issues.get` called with `issue_number: 5`; `issues.create` NOT called; `result.issueNumber === 5` and `result.issueUrl` matches the mock URL. Also updated the existing "issue creation" test to match the new title pattern `"Wiki Modification Artifacts"`.

## Verification

```
bun test src/knowledge/wiki-publisher.test.ts
→ 38 pass, 0 fail (was 37)

bunx tsc --noEmit 2>&1 | grep -E 'wiki-publisher|wiki-publisher-types|publish-wiki'
→ (no output) — zero errors on touched files

bun scripts/publish-wiki-updates.ts --help | grep "issue-number"
→ --issue-number <n>    Target issue number for live publish or --retrofit-preview
  (no mention of "requires --retrofit-preview")
```

## Diagnostics

- When publisher uses supplied issue: `logger.info({ issueNumber, issueUrl }, "Using supplied tracking issue #N")` appears in structured logs.
- If `issues.get` returns 404 (bad issue number), the error propagates as unhandled rejection; CLI exits 1 with `logger.error({ err }, "Wiki update publishing failed")`.
- CLI summary distinguishes: `Issue: #5 (supplied) — https://...` vs `Issue: #42 (created) — https://...`.
- To confirm bypass: run with `LOG_LEVEL=debug` and look for `"Using supplied tracking issue"` — its absence means `issues.create` was called instead.

## Deviations

- The task plan said "use `liveIssueNumber` (or reuse `retrofitIssueNumber`)" — chose `liveIssueNumber` for clarity.
- The `createMockOctokit()` helper needed a `get` mock added; the task plan only mentioned adding it to the new test's inline mock, but adding it to the shared helper was cleaner and avoids future test fragility.

## Known Issues

None.

## Files Created/Modified

- `scripts/publish-wiki-updates.ts` — `--issue-number` parsed outside `retrofitPreview` gate; `liveIssueNumber` passed to `publish()` unconditionally; CLI summary distinguishes supplied vs created
- `src/knowledge/wiki-publisher.ts` — branching step 5: `issues.get` for supplied issueNumber, `issues.create` (with updated title) otherwise; `issueNumber`/`issueUrl` declared as `let`
- `src/knowledge/wiki-publisher-types.ts` — updated `issueNumber` JSDoc to cover both run modes
- `src/knowledge/wiki-publisher.test.ts` — `issues.get` added to shared mock; new `"supplied issueNumber"` test; "issue creation" title pattern updated to `Wiki Modification Artifacts`
- `.gsd/milestones/M028/slices/S03/S03-PLAN.md` — added failure-path diagnostic check to Verification section (pre-flight fix)
