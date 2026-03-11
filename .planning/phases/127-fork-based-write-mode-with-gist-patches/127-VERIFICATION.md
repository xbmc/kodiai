---
phase: 127-fork-based-write-mode-with-gist-patches
verified: 2026-03-08T05:30:00Z
status: human_needed
score: 12/12 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 8/12
  gaps_closed:
    - "TypeScript compilation passes for all phase 127 source files (fork-manager.ts, gist-publisher.ts, mention.ts)"
    - "Agent system prompt in BOTH write-mode flows (mention + write-runner) includes fork-only instructions"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run write-mode via @mention with BOT_USER_PAT configured"
    expected: "Bot clones from fork (not target repo), creates branch in fork, opens cross-fork PR with forkOwner:branchName head format"
    why_human: "Cannot verify fork clone URL, upstream remote addition, or cross-fork PR creation programmatically without executing against GitHub"
  - test: "Run write-mode with single-file change via @mention (e.g. 'fix typo in README.md')"
    expected: "Gist created (not PR), gist link posted as comment with curl apply instructions"
    why_human: "Output routing (gist vs PR) path can only be confirmed by observing actual bot behavior"
  - test: "Run write-mode without BOT_USER_PAT configured"
    expected: "Warning logged ('Write-mode active without BOT_USER_PAT; using legacy direct-push behavior'), falls back gracefully"
    why_human: "Graceful degradation path requires observing runtime behavior and application logs"
---

# Phase 127: Fork-based Write Mode with Gist Patches -- Verification Report

**Phase Goal:** Configure write-mode to use forked repositories instead of creating branches in main, implement gist creation for patch requests, and add explicit instructions preventing the bot from creating branches directly.

**Verified:** 2026-03-08T05:30:00Z
**Status:** human_needed (all automated checks passed)
**Re-verification:** Yes -- after gap closure (Plan 04)

---

## Gap Closure Summary

**Previous status:** gaps_found (8/12, 2026-03-07T22:30:00Z)

**Gaps closed by Plan 04 (commits 5f0045bb, 3e8a1a37):**

1. **TypeScript compilation** -- 9 errors across 3 files resolved:
   - `src/jobs/fork-manager.ts`: `full_name.split("/")` now typed as `[string, string]` tuple assertion at 2 locations
   - `src/jobs/gist-publisher.ts`: `response.data.id` now uses non-null assertion (`!`)
   - `src/handlers/mention.ts`: Replaced `writeEnabled` (temporal dead zone) with preliminary `parseWriteIntent` call; fork setup block gates on `maybeWriteMode` instead

2. **Fork policy in write-runner** -- `FORK_WRITE_POLICY_INSTRUCTIONS` now imported and conditionally injected into Slack write-runner prompt when `forkContext` is active (line 11 import, line 257 injection)

**`npx tsc --noEmit` result:** 0 errors (project-wide)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Bot user PAT loaded from environment with graceful empty default | VERIFIED | `src/config.ts` lines 28-29, 94-95: `botUserPat: z.string().default("")` and `botUserPat: process.env.BOT_USER_PAT` |
| 2 | BotUserClient provides PAT-authenticated Octokit or disabled stub | VERIFIED | `src/auth/bot-user.ts`: enabled path creates `new Octokit({ auth: pat })`, disabled path returns stub |
| 3 | Fork can be lazily created for any upstream repo | VERIFIED | `src/jobs/fork-manager.ts`: `ensureFork()` checks cache, then existing fork, then creates via API with polling |
| 4 | Fork is synced with upstream default branch before use | VERIFIED | `src/jobs/fork-manager.ts`: `syncFork()` calls merge-upstream API, throws on 409 conflict |
| 5 | Secret gist can be created with patch content | VERIFIED | `src/jobs/gist-publisher.ts`: `createPatchGist()` calls `botClient.octokit.rest.gists.create({ public: false, ... })` |
| 6 | Write-mode clones from bot-owned fork, not target repo | VERIFIED | `src/jobs/workspace.ts` lines 544-551: forkContext branch uses `forkContext.botPat` and fork URL, adds upstream remote |
| 7 | Direct push to target repo prevented by code-level guard | VERIFIED | `src/jobs/workspace.ts`: `assertOriginIsFork()` exported and called in write-runner.ts line 328 |
| 8 | Cross-fork PRs use forkOwner:branchName head format | VERIFIED | `src/handlers/mention.ts` line ~2006 and `src/slack/write-runner.ts` line 366: `${forkContext.forkOwner}:${pushed.branchName}` |
| 9 | Output routing selects gist vs PR based on user intent | VERIFIED | `src/jobs/workspace.ts`: `shouldUseGist()` imported and used in both mention.ts and write-runner.ts line 287 |
| 10 | Fallback to gist on fork/PR failure | VERIFIED | Both handlers wrap fork setup in try/catch with gist fallback on PR creation failure |
| 11 | TypeScript compilation passes for all phase 127 files | VERIFIED | `npx tsc --noEmit` returns 0 errors; tuple assertion and non-null fix confirmed in source |
| 12 | Agent system prompt in ALL write-mode flows includes fork-only instructions | VERIFIED | mention.ts line 49 import + line 1723 use; write-runner.ts line 11 import + line 257 conditional injection |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config.ts` | BOT_USER_PAT and BOT_USER_LOGIN env vars in config schema | VERIFIED | `botUserPat` and `botUserLogin` fields with empty defaults |
| `src/auth/bot-user.ts` | BotUserClient with PAT-authenticated Octokit | VERIFIED | Full implementation: interface, factory function, enabled/disabled paths |
| `src/jobs/fork-manager.ts` | Fork lifecycle management (ensure, sync, cleanup) | VERIFIED | Full implementation; tuple assertions fix TS errors at lines 47 and 76 |
| `src/jobs/gist-publisher.ts` | Gist creation with patch content | VERIFIED | Full implementation; non-null assertion on `response.data.id!` at line 49 |
| `src/jobs/types.ts` | Updated CloneOptions with fork support | VERIFIED | `forkContext?: { forkOwner, forkRepo, botPat }` added |
| `src/jobs/workspace.ts` | Fork-aware workspace creation, push guard, routing helper | VERIFIED | `forkContext` branch in `create()`, `assertOriginIsFork()`, `shouldUseGist()` all present |
| `src/handlers/mention.ts` | Fork-based write flow with gist/PR routing; fork setup uses preliminary intent check | VERIFIED | `prelimWriteIntent`/`maybeWriteMode` gate fork setup; no temporal dead zone; 8 occurrences of `forkContext` |
| `src/slack/write-runner.ts` | Fork-based Slack write flow with policy instructions | VERIFIED | `FORK_WRITE_POLICY_INSTRUCTIONS` imported at line 11, conditionally injected at line 257 |
| `src/index.ts` | BotUserClient, ForkManager, GistPublisher initialization | VERIFIED | Lines 77-79: all three initialized and passed to both handlers |
| `src/execution/prompts.ts` | FORK_WRITE_POLICY_INSTRUCTIONS constant | VERIFIED | Exported constant present |
| `scripts/cleanup-legacy-branches.ts` | Legacy branch cleanup script | VERIFIED | Full implementation with --owner/--repo/--dry-run flags |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/auth/bot-user.ts` | `@octokit/rest` | PAT-based Octokit constructor | VERIFIED | `new Octokit({ auth: pat })` in enabled path |
| `src/jobs/fork-manager.ts` | `src/auth/bot-user.ts` | BotUserClient dependency | VERIFIED | Import present, used throughout |
| `src/jobs/gist-publisher.ts` | `src/auth/bot-user.ts` | BotUserClient for gist creation | VERIFIED | `botClient.octokit.rest.gists.create()` |
| `src/index.ts` | `src/auth/bot-user.ts` | createBotUserClient initialization | VERIFIED | Line 14 import, line 77 call |
| `src/index.ts` | `src/jobs/fork-manager.ts` | createForkManager initialization | VERIFIED | Line 15 import, line 78 call |
| `src/handlers/mention.ts` | `src/jobs/fork-manager.ts` | ensureFork before workspace creation | VERIFIED | Line 1049: `forkManager.ensureFork(mention.owner, mention.repo)` |
| `src/handlers/mention.ts` | `src/jobs/gist-publisher.ts` | createPatchGist for gist output | VERIFIED | Multiple uses of `gistPublisher.createPatchGist(...)` |
| `src/slack/write-runner.ts` | `src/jobs/fork-manager.ts` | ensureFork before workspace creation | VERIFIED | Line 210: `forkManager.ensureFork(input.owner, input.repo)` |
| `src/execution/prompts.ts` | agent prompt in mention.ts | FORK_WRITE_POLICY_INSTRUCTIONS | VERIFIED | mention.ts line 49 import, line 1723 use |
| `src/execution/prompts.ts` | agent prompt in write-runner.ts | FORK_WRITE_POLICY_INSTRUCTIONS | VERIFIED | write-runner.ts line 11 import, line 257 conditional injection |

---

### Requirements Coverage

FORK requirements tracked via plan frontmatter (no REQUIREMENTS.md exists in project).

| Requirement | Source Plan | Description | Status |
|-------------|------------|-------------|--------|
| FORK-01 | 127-01 | Bot user PAT config (BOT_USER_PAT, BOT_USER_LOGIN) in AppConfig | SATISFIED |
| FORK-02 | 127-01 | BotUserClient with PAT-authenticated Octokit or disabled stub | SATISFIED |
| FORK-03 | 127-01, 127-04 | ForkManager and GistPublisher foundation modules (compile cleanly) | SATISFIED |
| FORK-04 | 127-02 | Fork-aware workspace creation (clone from fork) | SATISFIED |
| FORK-05 | 127-02 | Push guard preventing direct target repo pushes | SATISFIED |
| FORK-06 | 127-02 | Output routing (gist vs PR selection) | SATISFIED |
| FORK-07 | 127-02 | Cross-fork PR creation with forkOwner:branchName head | SATISFIED |
| FORK-08 | 127-02 | Fallback chain (fork PR -> gist -> legacy) | SATISFIED |
| FORK-09 | 127-03, 127-04 | Agent system prompt with fork-only instructions in ALL write-mode flows | SATISFIED |
| FORK-10 | 127-03 | Legacy branch cleanup script for kodiai/* branches | SATISFIED |

All 10 requirements satisfied.

---

### Anti-Patterns Found

No anti-patterns found in phase 127 files. TypeScript compilation is clean (0 errors project-wide).

---

### Human Verification Required

#### 1. Fork-based Write via @mention with BOT_USER_PAT

**Test:** Trigger a write-mode request via GitHub @mention with BOT_USER_PAT and BOT_USER_LOGIN set in environment
**Expected:** Bot clones from fork URL (not target repo), pushes branch to fork, opens cross-fork PR with `forkOwner:branchName` head format
**Why human:** Cannot observe git clone URL, upstream remote configuration, or GitHub API call parameters without executing against live GitHub

#### 2. Gist Output for Single-file Change

**Test:** Request a single-file change via @mention (e.g., `@kodiai apply: fix typo in README.md`)
**Expected:** Gist created (not PR), gist link posted as issue comment with curl apply instructions
**Why human:** Output routing based on change complexity (`shouldUseGist`) requires observing actual bot behavior and GitHub comment creation

#### 3. Graceful Degradation Without BOT_USER_PAT

**Test:** Start bot without BOT_USER_PAT/BOT_USER_LOGIN set, trigger write-mode request
**Expected:** Log warning "Write-mode active without BOT_USER_PAT; using legacy direct-push behavior", continues without error
**Why human:** Runtime degradation path requires observing application logs and write-mode output

---

### Re-verification Result

| Gap (from previous VERIFICATION.md) | Previous Status | Current Status | Fix Applied |
|--------------------------------------|-----------------|----------------|-------------|
| TypeScript compilation errors in fork-manager.ts, gist-publisher.ts, mention.ts | FAILED | VERIFIED | Tuple assertion on `split("/")` (fork-manager); `!` on `response.data.id` (gist-publisher); `parseWriteIntent` preliminary check replacing `writeEnabled` (mention.ts) |
| Fork policy prompt missing from write-runner.ts | PARTIAL | VERIFIED | `FORK_WRITE_POLICY_INSTRUCTIONS` imported at line 11, conditionally injected at line 257 when `forkContext` is active |

**No regressions detected.** All 10 previously verified artifacts continue to exist and function as verified.

---

*Verified: 2026-03-08T05:30:00Z*
*Verifier: Claude (gsd-verifier)*
*Re-verification after Plan 04 gap closure (commits 5f0045bb, 3e8a1a37)*
