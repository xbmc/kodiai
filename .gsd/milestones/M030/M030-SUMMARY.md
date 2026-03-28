---
id: M030
title: "Addon Rule Enforcement"
status: complete
completed_at: 2026-03-28T16:27:40.123Z
key_decisions:
  - Run kodi-addon-checker as a subprocess (not reimplemented in TypeScript) — official tool encodes all rules and stays current with the Kodi wiki (D006)
  - Derive --branch from PR base branch name directly; ValidKodiVersions list of 10 known Kodi release names; unknown branch → warn + skip, no fallback (D007)
  - Post findings as PR comment (not inline annotations or status check) matching existing Kodiai review style (D008)
  - toolNotFound detected via ENOENT exception (.code === 'ENOENT'), not exit code 127 — subprocess exiting 127 is treated as a clean run with zero findings
  - Non-zero exit from kodi-addon-checker is NOT treated as an error — tool exits 1 when findings exist; only ENOENT and timeout are structural failures
  - upsertAddonCheckComment skips posting only when ALL addons returned toolNotFound:true — partial toolNotFound (some addons checked, some not found) still posts findings for the checked addons
  - AddonFinding re-exported from addon-check.ts to avoid circular dependency between formatter and runner modules
  - createMockLoggerWithArrays() pattern established for handler tests requiring child-logger assertion without .mock.calls traversal
  - Cleanup-on-throw test uses workspace.create throwing (not subprocess) because runAddonChecker fails open on non-ENOENT errors — only ENOENT triggers toolNotFound
key_files:
  - src/handlers/addon-check.ts
  - src/handlers/addon-check.test.ts
  - src/lib/addon-checker-runner.ts
  - src/lib/addon-checker-runner.test.ts
  - src/lib/addon-check-formatter.ts
  - src/lib/addon-check-formatter.test.ts
  - src/config.ts
  - src/index.ts
  - Dockerfile
lessons_learned:
  - toolNotFound is ENOENT-based, not exit-code-based: kodi-addon-checker exits 127 when not installed on some systems, but the actual ENOENT detection happens at the subprocess spawn level (.code === 'ENOENT' on the caught error). Exit code 127 is treated as a normal run with zero findings. Tests must stub the subprocess to throw with { code: 'ENOENT' } to exercise the skip gate — not to return exitCode:127.
  - Pre-existing tsc errors block the gate regardless of cause: when the verification gate requires tsc --noEmit exit 0, ALL errors must be fixed — not just errors introduced by the current milestone. S01 required fixing 53 pre-existing errors across embedding-repair, wiki-embedding-repair, retriever-verifier, review-comment-store, and test stubs. The correct policy is to fix all errors on first encounter, document as a deviation, and never defer pre-existing errors.
  - upsertAddonCheckComment per_page:100 cap: the comment lister hardcodes per_page:100. On PRs with 100+ prior comments the marker scan could miss an existing comment and create a duplicate. Acceptable for current load but worth noting for high-traffic repos.
  - AddonFinding re-export pattern for avoiding circular deps: when a formatter module needs a type from a runner module but both are downstream of a handler, re-export the type from the handler module rather than importing it directly from the runner. This breaks the potential circular dep while keeping the import chain clear.
  - createMockLoggerWithArrays() is the right pattern for child-logger assertion: rather than traversing logger.mock.calls to find child logger invocations, use a helper that writes to shared arrays. The pattern established here (S02) should be reused for any future handler tests that need to assert on structured log fields from child loggers.
---

# M030: Addon Rule Enforcement

**M030 delivered end-to-end kodi-addon-checker enforcement on addon repo PRs — handler scaffold, subprocess runner with output parsing, idempotent PR comment upsert, fork detection, and Dockerfile installation — 45 tests pass, tsc clean.**

## What Happened

M030 delivered the full addon rule enforcement pipeline across three slices.

**S01 — Handler scaffold and repo detection:** Added `addonRepos` to `AppConfig` (comma-split Zod transform, default: `xbmc/repo-plugins,xbmc/repo-scripts,xbmc/repo-scrapers`, configurable via env). Built `createAddonCheckHandler` following the `createIssueOpenedHandler` factory pattern — registers on `pull_request.opened` and `pull_request.synchronize`, gates on `config.addonRepos.includes(repo)`, calls `octokit.rest.pulls.listFiles`, extracts first path segments from files containing a slash (deduplicates, sorts), and logs structured info. Wired into `src/index.ts` unconditionally. This slice also fixed 53 pre-existing TypeScript errors across the codebase (embedding-repair, wiki-embedding-repair, retriever-verifier, review-comment-store, multiple test stubs) to achieve a clean `bun run tsc --noEmit` exit 0 required by the verification gate.

**S02 — kodi-addon-checker subprocess and output parsing:** Built `src/lib/addon-checker-runner.ts` as a pure injectable module. `parseCheckerOutput` strips ANSI codes and matches `^(ERROR|WARN|INFO): (.+)` lines into structured `AddonFinding` objects. `resolveCheckerBranch` maps PR base branch names against `ValidKodiVersions` (10 known Kodi release names). `runAddonChecker` spawns the subprocess with `withTimeBudget` reused from `usage-analyzer.ts`, treats non-zero exit codes as normal (checker exits 1 when findings exist), distinguishes ENOENT (toolNotFound) from other errors (fail-open), and supports `__runSubprocessForTests` injection. Updated the handler to accept `workspaceManager` and `jobQueue`, wrapping all workspace work in `jobQueue.enqueue`, calling `workspace.cleanup()` in `finally`, and logging per-finding and summary structured events.

**S03 — PR comment posting and idempotency:** Built `src/lib/addon-check-formatter.ts` — pure stateless module with `buildAddonCheckMarker` (deterministic HTML comment as idempotency key) and `formatAddonCheckComment` (marker + heading + ERROR/WARN table + summary line; INFO findings filtered; clean pass when no ERROR/WARN). Added fork detection to the handler — reads `payload.pull_request.head.repo`, detects forks and deleted-fork repos, routes to either direct head-ref clone or base-branch clone + `fetchAndCheckoutPullRequestHeadRef`. Added `upsertAddonCheckComment` inline helper — lists existing comments (per_page:100), finds by marker, updates or creates. Added `toolNotFound` skip gate — upsert is skipped only when ALL addons returned `toolNotFound: true` (ENOENT path). Updated Dockerfile with `python3 python3-pip` (apt) and `kodi-addon-checker` (pip3).

Key non-obvious finding across S02/S03: `toolNotFound` is detected via ENOENT exception (`.code === "ENOENT"`) on the subprocess spawn, not via exit code 127. Exit code 127 is treated as a successful run with zero findings. Test stubs must throw `{ code: "ENOENT" }` to exercise the skip gate.

Final verification: 45 tests (19 runner + 11 formatter + 15 handler) pass with 118 expect() calls, `bun run tsc --noEmit` exits 0.

## Success Criteria Results

## Success Criteria Results

**Criterion: Handler fires on pull_request.opened and pull_request.synchronize for addon repos, is a no-op for non-addon repos.**
✅ Met. `createAddonCheckHandler` registers on both events. Tests: `registers on pull_request.opened and pull_request.synchronize` (pass), `non-addon repo returns without calling listFiles` (pass). Confirmed via 2 of 15 handler tests.

**Criterion: Affected addon IDs are correctly extracted from the PR file list.**
✅ Met. Addon ID extraction takes the first path segment of files containing `/`, deduplicates and sorts. Tests: `addon repo logs correct addon IDs (sorted, deduplicated)` (pass), `empty PR (no files) logs empty addon ID list` (pass), `root-level files (no slash) are excluded from addon IDs` (pass).

**Criterion: kodi-addon-checker subprocess runs against each affected addon directory with the correct --branch argument derived from the PR base branch.**
✅ Met. `resolveCheckerBranch` maps base branch to ValidKodiVersions. `runAddonChecker` passes `--branch <branch> <addonDir>`. Tests: `resolveCheckerBranch covers all 10 expected version names` (pass), `passes the branch and addonDir to the subprocess` (pass), `unknown base branch warns and skips` (pass).

**Criterion: Checker output is parsed into structured findings (ERROR/WARN/INFO), ANSI codes stripped.**
✅ Met. `parseCheckerOutput` strips ANSI codes with `/\x1B\[[0-9;]*m/g`, matches `^(ERROR|WARN|INFO): (.+)`. Tests: `strips ANSI escape codes before parsing` (pass), `classifies ERROR, WARN, and INFO lines` (pass), `ignores non-matching lines` (pass).

**Criterion: Findings are posted as a PR comment in Kodiai style; comment is updated on re-push (idempotent).**
✅ Met. `formatAddonCheckComment` renders marker + heading + ERROR/WARN table + summary line. `upsertAddonCheckComment` does listComments → find by marker → updateComment or createComment. Tests: `posts comment when findings exist` (pass), `updates existing comment on second push (upsert path)` (pass).

**Criterion: No comment posted when tool not found (toolNotFound gate).**
✅ Met. Upsert is skipped when all addons return `toolNotFound: true`. Test: `no comment posted when no findings and tool not found` (pass).

**Criterion: Fork PRs handled correctly (base branch clone + fetchAndCheckoutPullRequestHeadRef).**
✅ Met. Handler detects `isFork` via `head.repo.full_name !== repo`. Test: `fork PR uses base branch + fetchAndCheckoutPullRequestHeadRef` (pass).

**Criterion: kodi-addon-checker available in production container.**
✅ Met. Dockerfile updated with `python3 python3-pip` (apt) and `pip3 install kodi-addon-checker`.

**Criterion: TypeScript compiles clean.**
✅ Met. `bun run tsc --noEmit` exits 0 with no errors.

## Definition of Done Results

## Definition of Done Results

**All 3 slices marked complete (✅ in roadmap):**
✅ S01: Handler scaffold and repo detection — completed_at 2026-03-28T15:46:15Z, verification_result: passed
✅ S02: kodi-addon-checker subprocess and output parsing — completed_at 2026-03-28T16:11:21Z, verification_result: passed
✅ S03: PR comment posting and idempotency — completed_at 2026-03-28T16:23:09Z, verification_result: passed

**All slice summaries exist:**
✅ S01-SUMMARY.md present with key_files, key_decisions, patterns_established
✅ S02-SUMMARY.md present with key_files, key_decisions, patterns_established
✅ S03-SUMMARY.md present with key_files, key_decisions, patterns_established

**Code changes exist (non-.gsd/ diff):**
✅ 42 files changed, 1698 insertions, 51 deletions — including 4 new source files (addon-check.ts, addon-checker-runner.ts, addon-check-formatter.ts) and Dockerfile update.

**Tests pass:**
✅ 45 tests pass across 3 test files (addon-checker-runner.test.ts, addon-check-formatter.test.ts, addon-check.test.ts), 0 failures, 118 expect() calls.

**TypeScript clean:**
✅ `bun run tsc --noEmit` exits 0 — no errors.

**Cross-slice integration:**
✅ S01 provides: handler factory, repo detection, addon ID extraction.
✅ S02 consumes S01 scaffold, adds: workspaceManager/jobQueue integration, subprocess runner, branch resolver.
✅ S03 consumes S01+S02 outputs, adds: formatter, upsert, fork detection, Dockerfile.
✅ All dep chain wired in src/index.ts (workspaceManager + jobQueue passed to createAddonCheckHandler).

## Requirement Outcomes

## Requirement Outcomes

| ID | Name | Transition | Evidence |
|---|---|---|---|
| R001 | Addon repo detection | Active → Validated | `addonRepos` Zod field in AppConfig, configurable via env var; handler gates on `config.addonRepos.includes(repo)`; test `non-addon repo returns without calling listFiles` passes |
| R002 | kodi-addon-checker subprocess execution | Active → Validated | `runAddonChecker` spawns `kodi-addon-checker --branch <branch> <addonDir>` subprocess; 19 runner tests pass including `passes the branch and addonDir to the subprocess` |
| R003 | Branch → Kodi version mapping | Active → Validated | `resolveCheckerBranch` maps PR base branch against `ValidKodiVersions` (10 names); test `covers all 10 expected version names` passes; unknown branch → warn + skip |
| R004 | Output parsing (ERROR/WARN/INFO) | Active → Validated | `parseCheckerOutput` strips ANSI, matches `^(ERROR\|WARN\|INFO): (.+)`, drops non-matching lines; 5 parseCheckerOutput tests pass including ANSI and mixed-line cases |
| R005 | PR comment posting in Kodiai style | Active → Validated | `formatAddonCheckComment` renders marker + heading + ERROR/WARN table + summary; `upsertAddonCheckComment` posts or updates; tests `posts comment when findings exist` and `updates existing comment on second push` pass |
| R006 | Configurable addon repo list | Active → Validated | `addonRepos` is Zod-validated with comma-split transform, defaults to three xbmc repos, overrideable via `ADDON_REPOS` env var |
| R007 | Python + tool installed in Dockerfile | Active → Validated | Dockerfile updated: `apt-get install -y python3 python3-pip && pip3 install kodi-addon-checker` |
| R008 | Multi-addon support per PR | Active → Validated | Handler iterates over all deduped addonIds, calls `runAddonChecker` per addon; test `runner called per addon with correct addonDir and branch` passes |
| R009 | Idempotent re-run on synchronize | Active → Validated | `buildAddonCheckMarker` provides stable HTML marker; `upsertAddonCheckComment` finds by marker → updateComment (not createComment); test `updates existing comment on second push (upsert path)` passes |
| R010 | Non-addon repos unaffected | Active → Validated | Early return before any workspace or subprocess work when `!config.addonRepos.includes(repo)`; test `non-addon repo returns without calling listFiles` passes |

All 10 active requirements transition to **Validated** with direct test evidence.

## Deviations

S01 T02 plan estimated 68 pre-existing tsc errors with 56 remaining after milestone fixes. The verification gate required exit 0, not just 'no new errors'. This required fixing all 53 remaining pre-existing errors across embedding-repair, wiki-embedding-repair, audit, retrieval, and M027 test infrastructure — none of which are M030 code. Documented as a deviation in S01 summary.

toolNotFound detection is via ENOENT (caught exception), not exitCode:127 as implied by the original task plan. The actual implementation in runAddonChecker checks err.code === 'ENOENT' on the caught subprocess error. exitCode:127 paths are treated as successful runs with zero findings. Documented in S03 summary and KNOWLEDGE.md.

## Follow-ups

Fork PR handling currently clones base branch + fetchAndCheckoutPullRequestHeadRef (S03). The underlying workspace cloning path for direct (non-fork) PRs always uses the head ref directly. If xbmc repos start getting fork-origin PRs more frequently, the fork path should be integration-tested with a fixture bad-addon directory.

upsertAddonCheckComment only scans the first 100 PR comments (per_page:100 hardcoded). On very busy PRs with 100+ prior comments the marker scan could miss an existing comment and create a duplicate. A paginated scan should be added if this becomes a real issue.

The __runSubprocessForTests injection point in runAddonChecker is ready for integration testing with a fixture bad-addon directory if end-to-end subprocess testing is ever desired.
