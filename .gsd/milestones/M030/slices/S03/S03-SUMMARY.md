---
id: S03
parent: M030
milestone: M030
provides:
  - Idempotent PR comment upsert for addon findings (marker-based)
  - Fork detection routing (base branch + fetchAndCheckoutPullRequestHeadRef vs head ref direct clone)
  - Pure formatter module (buildAddonCheckMarker, formatAddonCheckComment)
  - Dockerfile with python3 + kodi-addon-checker installed
requires:
  - slice: S01
    provides: Handler scaffold, repo detection, addon ID extraction, workspace integration
  - slice: S02
    provides: runAddonChecker subprocess runner, AddonFinding type, toolNotFound detection pattern
affects:
  []
key_files:
  - src/lib/addon-check-formatter.ts
  - src/lib/addon-check-formatter.test.ts
  - src/handlers/addon-check.ts
  - src/handlers/addon-check.test.ts
  - Dockerfile
key_decisions:
  - AddonFinding imported via re-export in addon-check.ts to avoid circular dep between formatter and runner
  - toolNotFound skip gate: upsert is skipped only when ALL addons returned toolNotFound:true (ENOENT path, not exitCode:127)
  - upsertAddonCheckComment is unexported inline helper — typed octokit slice, not full Octokit type
  - __fetchAndCheckoutForTests injection mirrors __runSubprocessForTests pattern from S02 for testability without module mocking
patterns_established:
  - Idempotent PR comment upsert via HTML marker: listComments → find by marker → updateComment or createComment
  - toolNotFound detection via ENOENT exception, not exit code — see KNOWLEDGE.md entry
  - createMockOctokitWithIssues helper pattern for testing PR comment mutations (established in M030/S02 and extended here)
observability_surfaces:
  - Handler logs summary with addonIds and totalFindings on completion
  - upsertAddonCheckComment skip logged implicitly via the toolNotFoundCount guard (no explicit log, but the comment absence is the signal)
drill_down_paths:
  - .gsd/milestones/M030/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M030/slices/S03/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-28T16:23:09.325Z
blocker_discovered: false
---

# S03: PR comment posting and idempotency

**Wired addon findings into an idempotent PR comment upsert, added fork detection, and updated the Dockerfile — 26 tests pass, tsc clean.**

## What Happened

S03 completed in two tasks with no blockers.

T01 built `src/lib/addon-check-formatter.ts` — a pure, stateless module with two exports. `buildAddonCheckMarker(owner, repo, prNumber)` returns a deterministic HTML comment string used as the idempotency key when scanning existing PR comments. `formatAddonCheckComment(findings, marker)` renders the full comment body: marker on line 1, a `## Kodiai Addon Check` heading, a markdown table of ERROR+WARN findings (INFO filtered), and a `_X error(s), Y warning(s) found._` summary line. When there are no ERROR/WARN findings the clean-pass branch emits no table at all. `AddonFinding` is imported from the re-export in `addon-check.ts` to avoid circular deps. 11 unit tests cover all branches including empty findings, all-INFO input, multi-addon rows, zero counts, and marker placement.

T02 wired the formatter into the handler and extended the test suite. Three changes were made to `src/handlers/addon-check.ts`:

1. **Fork detection** — reads `payload.pull_request.head.repo`; sets `isFork = Boolean(headRepo && headRepo.full_name !== repo)` and `isDeletedFork = !headRepo`. Fork and deleted-fork PRs clone the base branch then call `fetchAndCheckoutPullRequestHeadRef` to overlay the PR head. Non-fork PRs continue to clone the head ref directly.

2. **Idempotent upsert** — inline `upsertAddonCheckComment` helper (unexported) lists existing PR comments, finds one whose body contains the marker, then calls `updateComment` if found or `createComment` if not. The upsert is skipped entirely when all addons returned `toolNotFound: true` (checker binary absent from the runner environment).

3. **Dockerfile** — adds `python3 python3-pip` via apt and `kodi-addon-checker` via pip3, so the checker is available in the production container.

4 new tests were added to `addon-check.test.ts` (bringing total to 15): posts-comment when findings exist, skips comment when all toolNotFound, updates existing comment on re-push (upsert path), and fork PR path. A `createMockOctokitWithIssues` helper adds `listComments`/`createComment`/`updateComment` stubs to the existing mock. The fork test uses `__fetchAndCheckoutForTests` injection mirroring the `__runSubprocessForTests` pattern established in S02.

Key non-obvious finding: `toolNotFound` is detected via caught ENOENT error (`.code === "ENOENT"`), not via exitCode:127. A subprocess exiting with 127 takes the success branch. Tests must stub the subprocess to throw with `{ code: "ENOENT" }` to exercise the skip gate.

## Verification

T01: `bun test src/lib/addon-check-formatter.test.ts` — 11 pass, 0 fail, 8ms.
T02: `bun test src/handlers/addon-check.test.ts` — 15 pass, 0 fail, 22ms.
T02: `bun run tsc --noEmit` — exit 0, no output.
All three gates verified clean on slice close.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

toolNotFound detection is via ENOENT (caught exception), not exitCode:127 as implied by the task plan. The actual implementation in runAddonChecker checks `err.code === "ENOENT"` on the caught subprocess error. exitCode:127 paths are treated as successful runs with zero findings.

## Known Limitations

upsertAddonCheckComment only scans the first 100 PR comments (per_page:100 hardcoded). On very busy PRs with 100+ prior comments the marker scan could miss an existing comment and create a duplicate. Acceptable for the current use case.

## Follow-ups

None.

## Files Created/Modified

- `src/lib/addon-check-formatter.ts` — New pure formatter module: buildAddonCheckMarker and formatAddonCheckComment
- `src/lib/addon-check-formatter.test.ts` — 11 unit tests for formatter (marker format, table rendering, clean pass, INFO filtering, summary counts)
- `src/handlers/addon-check.ts` — Added fork detection, upsertAddonCheckComment helper, toolNotFound skip gate, formatter imports
- `src/handlers/addon-check.test.ts` — Extended with createMockOctokitWithIssues helper and 4 new tests (posts, skips, upserts, fork path); 15 total
- `Dockerfile` — Added python3, python3-pip (apt) and kodi-addon-checker (pip3) for production container
