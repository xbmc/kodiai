---
id: T02
parent: S01
milestone: M030
provides: []
requires: []
affects: []
key_files: ["src/index.ts", "src/routes/slack-commands.test.ts", "src/routes/slack-events.test.ts", "scripts/backfill-issues.ts", "scripts/backfill-pr-evidence.ts", "scripts/backfill-review-comments.ts", "scripts/cleanup-legacy-branches.ts", "scripts/cleanup-wiki-issue.ts", "scripts/publish-wiki-updates.ts", "scripts/sync-triage-reactions.ts", "scripts/verify-m029-s04.ts"]
key_decisions: ["Registered createAddonCheckHandler unconditionally — only needs eventRouter/githubApp/config/logger, no optional stores required", "Added addonRepos: [] to all 10 pre-existing AppConfig stubs to resolve T01-introduced TS errors"]
patterns_established: []
drill_down_paths: []
observability_surfaces: []
duration: ""
verification_result: "Ran bun run tsc --noEmit before and after. Baseline: 68 errors (all pre-existing). After T02 fixes: 56 errors — 12 fewer (the addonRepos stubs), zero new errors. All remaining errors are pre-existing in embedding-repair, wiki-store, M027 harnesses, and retrieval tests — none in M030 files. Confirmed pre-existing baseline via git stash test."
completed_at: 2026-03-28T15:29:11.783Z
blocker_discovered: false
---

# T02: Wired createAddonCheckHandler into src/index.ts unconditionally and fixed addonRepos TypeScript errors in 10 stub files

> Wired createAddonCheckHandler into src/index.ts unconditionally and fixed addonRepos TypeScript errors in 10 stub files

## What Happened
---
id: T02
parent: S01
milestone: M030
key_files:
  - src/index.ts
  - src/routes/slack-commands.test.ts
  - src/routes/slack-events.test.ts
  - scripts/backfill-issues.ts
  - scripts/backfill-pr-evidence.ts
  - scripts/backfill-review-comments.ts
  - scripts/cleanup-legacy-branches.ts
  - scripts/cleanup-wiki-issue.ts
  - scripts/publish-wiki-updates.ts
  - scripts/sync-triage-reactions.ts
  - scripts/verify-m029-s04.ts
key_decisions:
  - Registered createAddonCheckHandler unconditionally — only needs eventRouter/githubApp/config/logger, no optional stores required
  - Added addonRepos: [] to all 10 pre-existing AppConfig stubs to resolve T01-introduced TS errors
duration: ""
verification_result: mixed
completed_at: 2026-03-28T15:29:11.783Z
blocker_discovered: false
---

# T02: Wired createAddonCheckHandler into src/index.ts unconditionally and fixed addonRepos TypeScript errors in 10 stub files

**Wired createAddonCheckHandler into src/index.ts unconditionally and fixed addonRepos TypeScript errors in 10 stub files**

## What Happened

Added the import for createAddonCheckHandler in src/index.ts after the createIssueClosedHandler import. Registered the handler unconditionally (outside the issueStore guard) since it only needs eventRouter, githubApp, config, and logger. Running tsc --noEmit revealed that T01's addonRepos field addition caused TS errors in 10 script/test files with AppConfig literal stubs. Fixed all 10 by adding addonRepos: []. Baseline had 68 pre-existing errors; after fixes the count is 56 — 12 fewer, zero new errors introduced by M030 work.

## Verification

Ran bun run tsc --noEmit before and after. Baseline: 68 errors (all pre-existing). After T02 fixes: 56 errors — 12 fewer (the addonRepos stubs), zero new errors. All remaining errors are pre-existing in embedding-repair, wiki-store, M027 harnesses, and retrieval tests — none in M030 files. Confirmed pre-existing baseline via git stash test.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun run tsc --noEmit (baseline pre-T02)` | 2 | ⚠️ 68 pre-existing errors | 6100ms |
| 2 | `bun run tsc --noEmit (post-T02 all fixes)` | 2 | ✅ 56 errors (−12 vs baseline, 0 new M030 errors) | 6600ms |


## Deviations

T01's addonRepos field addition propagated TypeScript errors to 10 existing stub objects not mentioned in the task plan. Fixed all of them as part of this task.

## Known Issues

Pre-existing tsc errors in embedding-repair, wiki, and M027 verification scripts. Existed before M030 (confirmed via git stash).

## Files Created/Modified

- `src/index.ts`
- `src/routes/slack-commands.test.ts`
- `src/routes/slack-events.test.ts`
- `scripts/backfill-issues.ts`
- `scripts/backfill-pr-evidence.ts`
- `scripts/backfill-review-comments.ts`
- `scripts/cleanup-legacy-branches.ts`
- `scripts/cleanup-wiki-issue.ts`
- `scripts/publish-wiki-updates.ts`
- `scripts/sync-triage-reactions.ts`
- `scripts/verify-m029-s04.ts`


## Deviations
T01's addonRepos field addition propagated TypeScript errors to 10 existing stub objects not mentioned in the task plan. Fixed all of them as part of this task.

## Known Issues
Pre-existing tsc errors in embedding-repair, wiki, and M027 verification scripts. Existed before M030 (confirmed via git stash).
