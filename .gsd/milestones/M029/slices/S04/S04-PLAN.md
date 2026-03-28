# S04: Re-generation, Re-publication & Proof Harness

**Goal:** Implement the M029-S04 proof harness (`scripts/verify-m029-s04.ts`) with 5 checks (2 pure-code, 2 DB-gated, 1 GitHub-gated), its test suite, the `package.json` entry, and an operational runbook documenting the DB-cleanup → re-generation → issue-cleanup → re-publication sequence an operator must run before the harness can achieve a full live pass.

**Demo:** `bun run verify:m029:s04 --json` exits 0 with `overallPassed: true` after the operator has run the operational sequence. `bun test scripts/verify-m029-s04.test.ts` passes with all 5 check behaviors covered (pure-code checks always pass in CI; DB/GitHub checks exercise skip + pass/fail paths via mocks).

## Must-Haves

- `scripts/verify-m029-s04.ts` with exactly 5 check IDs, evaluator, harness entry point, and CLI runner — following the M028-S04 pattern exactly
- `scripts/verify-m029-s04.test.ts` covering check-ID contract, envelope shape, all 5 checks (skip/pass/fail), overallPassed semantics, and harness entry-point behavior
- `package.json` gains `"verify:m029:s04": "bun scripts/verify-m029-s04.ts"` in the `scripts` block
- `docs/m029-s04-ops-runbook.md` documents the 5 operational steps (DB cleanup, re-generation, issue cleanup, re-publication, proof verification) with exact commands
- `bun test scripts/verify-m029-s04.test.ts` passes with 0 failures
- Pure-code checks (CONTENT-FILTER-REJECTS, PROMPT-BANS-META) never skip and pass in CI without DB or GitHub
- DB-gated checks (NO-REASONING-IN-DB, LIVE-PUBLISHED) skip gracefully when no sql provided
- GitHub-gated check (ISSUE-CLEAN) skips gracefully when no octokit provided

## Proof Level

- This slice proves: final-assembly
- Real runtime required: yes (for full LIVE-PUBLISHED and ISSUE-CLEAN pass; pure-code checks always pass without infra)
- Human/UAT required: yes (operator must run the 5 operational steps documented in the runbook before the DB/GitHub checks produce non-skipped results)

## Verification

- `bun test scripts/verify-m029-s04.test.ts` — all tests pass; covers 5 check behaviors with mocks
- `bun run verify:m029:s04 --json` — exits 0 with `overallPassed: true` after the operational steps complete (DB + GitHub checks non-skipped and passing)
- `bun test src/knowledge/wiki-voice-validator.test.ts src/knowledge/wiki-voice-analyzer.test.ts src/knowledge/wiki-update-generator.test.ts` — baseline still 0 failures (S04 adds no changes to these files)

## Observability / Diagnostics

- Runtime signals: harness emits per-check `status_code` fields (e.g. `reasoning_rows_found`, `unmarked_comments_found`, `db_unavailable`, `github_unavailable`)
- Inspection surfaces: `bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'` surfaces failing checks with detail; `SELECT suggestion FROM wiki_update_suggestions WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'` inspects residual DB rows
- Failure visibility: each check's `detail` field includes count (e.g. `count=N`, `violations=N`), connection error message on skip, or snippet on mismatch
- Redaction constraints: none — no secrets in harness output

## Integration Closure

- Upstream surfaces consumed: `isReasoningProse` from S01 (`src/knowledge/wiki-voice-validator.ts`); `buildVoicePreservingPrompt` from S01 (`src/knowledge/wiki-voice-analyzer.ts`); `createGitHubApp` from `src/auth/github-app.ts`; `createDbClient` from `src/db/client.ts`; cleanup script from S03 (`scripts/cleanup-wiki-issue.ts`) used in runbook only
- New wiring introduced in this slice: `verify:m029:s04` npm script entry; harness imports S01 functions directly for pure-code checks
- What remains before the milestone is truly usable end-to-end: operator must execute the 5 operational steps in the runbook (DB cleanup → re-generation → issue cleanup → re-publication → proof run)

## Tasks

- [x] **T01: Implement M029-S04 proof harness, tests, package.json entry, and ops runbook** `est:2h`
  - Why: Closes the milestone by providing the 5-check proof harness that verifies the assembled pipeline (S01 prompt fix + content filter + S02 heuristic threshold + S03 issue cleanup) produced quality output and a clean issue
  - Files: `scripts/verify-m029-s04.ts`, `scripts/verify-m029-s04.test.ts`, `package.json`, `docs/m029-s04-ops-runbook.md`
  - Do: Implement `verify-m029-s04.ts` following `verify-m028-s04.ts` pattern exactly; implement test suite mirroring `verify-m028-s04.test.ts` structure; add npm script entry; write ops runbook with exact commands
  - Verify: `bun test scripts/verify-m029-s04.test.ts` passes 0 failures; `grep "verify:m029:s04" package.json` finds the entry
  - Done when: All tests pass and harness exits 0 on pure-code checks with no DB/GitHub

## Files Likely Touched

- `scripts/verify-m029-s04.ts`
- `scripts/verify-m029-s04.test.ts`
- `package.json`
- `docs/m029-s04-ops-runbook.md`
