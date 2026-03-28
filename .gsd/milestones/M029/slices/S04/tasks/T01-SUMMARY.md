---
id: T01
parent: S04
milestone: M029
provides:
  - scripts/verify-m029-s04.ts with 5 checks (2 pure-code, 2 DB-gated, 1 GitHub-gated)
  - scripts/verify-m029-s04.test.ts with 51 tests covering all check behaviors
  - package.json verify:m029:s04 script entry
  - docs/m029-s04-ops-runbook.md with 5 operational steps and exact commands
key_files:
  - scripts/verify-m029-s04.ts
  - scripts/verify-m029-s04.test.ts
  - package.json
  - docs/m029-s04-ops-runbook.md
key_decisions:
  - Injected _contentFilterFn and _promptBuilderFn mock overrides follow M028-S04 pattern (suffix _ on injected fns) to allow test isolation of pure-code checks without touching real imports
  - GitHub auth reuses the same AppConfig shape and call sequence as cleanup-wiki-issue.ts (createGitHubApp → initialize → getRepoInstallationContext → getInstallationOctokit)
  - ISSUE-CLEAN violation rule: lacks BOTH the modification marker AND is not the summary table — matches cleanup-wiki-issue.ts classification logic
patterns_established:
  - Pure-code harness checks accept optional mock-override fn parameters (prefixed _) for test isolation — the real import is used when the parameter is absent
  - Octokit injection pattern: makeOctokitStub(pages) returns a minimal typed stub matching only the listComments shape used by the check
  - Sequential SQL stub (makeSequentialSqlStub) is the right tool when two DB checks in the same evaluator call need different return values
observability_surfaces:
  - bun run verify:m029:s04 --json — JSON report with per-check status_code, passed, skipped, detail
  - bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)' — surface failing checks
  - bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | {id, status_code, detail}' — compact status scan
  - stderr: "verify:m029:s04 failed: <id>:<status_code>,..." on any non-skipped check failure (exit 1)
duration: ~35min
verification_result: passed
completed_at: 2026-03-21
blocker_discovered: false
---

# T01: Implement M029-S04 proof harness, tests, package.json entry, and ops runbook

**Implemented the 5-check M029-S04 proof harness with 51 passing tests, npm script entry, and ops runbook — pure-code checks pass without DB/GitHub; DB/GitHub checks skip gracefully when infra is absent.**

## What Happened

Built all four deliverables following the M028-S04 structural template exactly.

**`scripts/verify-m029-s04.ts`** — the harness with:
- 5 check functions: `runContentFilterRejects`, `runPromptBansMeta`, `runNoReasoningInDb`, `runLivePublished`, `runIssueClean`
- Each check accepts optional mock-override parameters (`_contentFilterFn`, `_promptBuilderFn`) for test isolation
- `evaluateM029S04(opts?)` runs all 5 with `Promise.all` and computes `overallPassed` excluding skipped checks
- `buildM029S04ProofHarness(opts?)` auto-probes `DATABASE_URL` and `GITHUB_APP_ID`+`GITHUB_PRIVATE_KEY` on startup (both wrapped in try/catch, skip on failure)
- ISSUE-CLEAN paginator: `for (let page = 1; ; page++)` with break on `data.length < 100`
- GitHub auth sequence mirrors `scripts/cleanup-wiki-issue.ts` exactly: `createGitHubApp → initialize → getRepoInstallationContext → getInstallationOctokit`
- CLI runner with `import.meta.main`, `--json` flag

**`scripts/verify-m029-s04.test.ts`** — 51 tests across 8 groups:
- Check ID contract (7 tests), Envelope shape (4 tests)
- CONTENT-FILTER-REJECTS (3), PROMPT-BANS-META (4), NO-REASONING-IN-DB (4), LIVE-PUBLISHED (5), ISSUE-CLEAN (5)
- overallPassed semantics (8), buildM029S04ProofHarness (5), All checks present (5)
- SQL mocks: `makeSqlStub` (same rows all calls) and `makeSequentialSqlStub` (per-call index) copied from M028-S04 test
- Octokit mock: `makeOctokitStub(pages)` — per-page arrays, returns `pages[page-1] ?? []`

**`package.json`** — added `"verify:m029:s04": "bun scripts/verify-m029-s04.ts"` immediately after `"verify:m028:s04"`.

**`docs/m029-s04-ops-runbook.md`** — 5-step runbook with exact commands, prerequisite env var list, skip-vs-pass table, and failure diagnostic queries.

## Verification

All four slice verification checks ran and passed:

1. `bun test ./scripts/verify-m029-s04.test.ts` → 51 pass, 0 fail
2. `grep '"verify:m029:s04"' package.json` → found the entry
3. `bun run verify:m029:s04 --json 2>&1 | head -10` → valid JSON with `overallPassed: true` (pure-code pass, DB/GitHub skipped)
4. `bun test ./src/knowledge/wiki-voice-validator.test.ts ./src/knowledge/wiki-voice-analyzer.test.ts ./src/knowledge/wiki-update-generator.test.ts` → 88 pass, 0 fail (S01 regression guard clean)

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m029-s04.test.ts` | 0 | ✅ pass | 167ms |
| 2 | `grep '"verify:m029:s04"' package.json` | 0 | ✅ pass | <1ms |
| 3 | `bun run verify:m029:s04 --json 2>&1 \| head -10` | 0 | ✅ pass | ~2s |
| 4 | `bun test ./src/knowledge/wiki-voice-validator.test.ts ./src/knowledge/wiki-voice-analyzer.test.ts ./src/knowledge/wiki-update-generator.test.ts` | 0 | ✅ pass | 186ms |

## Diagnostics

- `bun run verify:m029:s04 --json` — full JSON report with per-check status_code, passed, skipped, detail
- `bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'` — surface failing checks
- stderr line `verify:m029:s04 failed: <id>:<status_code>,...` written on exit 1
- DB inspection: `SELECT suggestion FROM wiki_update_suggestions WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'`
- Published rows: `SELECT COUNT(*) FROM wiki_update_suggestions WHERE published_at IS NOT NULL`

## Deviations

None — implementation followed the task plan exactly. The pre-flight note about adding `## Observability Impact` to T01-PLAN.md referenced content that appears only in the auto-mode injected prompt, not in the actual plan file on disk (the file ends at `## Expected Output`); the observability documentation is captured here in the summary instead.

## Known Issues

None. Full live pass (all 5 checks non-skipped) requires the operator to complete the 5 steps in `docs/m029-s04-ops-runbook.md` (DB cleanup → re-generation → issue cleanup → re-publication → proof run) with `DATABASE_URL`, `GITHUB_APP_ID`, and `GITHUB_PRIVATE_KEY` set.

## Files Created/Modified

- `scripts/verify-m029-s04.ts` — 5-check proof harness: exported types, check functions, evaluator, harness entry point, CLI runner
- `scripts/verify-m029-s04.test.ts` — 51-test suite covering all check behaviors via mocks
- `package.json` — added `verify:m029:s04` script entry after `verify:m028:s04`
- `docs/m029-s04-ops-runbook.md` — operational runbook: 5 steps with exact commands, skip/pass table, diagnostic queries
