# S04 UAT — Re-generation, Re-publication & Proof Harness

**Slice:** M029/S04  
**Risk:** medium  
**Date:** 2026-03-21

---

## Preconditions

- Working directory: project root
- Node/Bun: `bun --version` returns `1.3.x` or later
- No DB or GitHub auth is required for the pure-code and mock-based tests
- For live DB/GitHub checks (TC-07 through TC-09), the operator must have run all 5 steps in `docs/m029-s04-ops-runbook.md`

---

## Test Cases

### TC-01: Package script entry exists

**Goal:** Confirm `verify:m029:s04` is registered in `package.json`.

**Steps:**
1. `grep '"verify:m029:s04"' package.json`

**Expected outcome:**
- Output contains `"verify:m029:s04": "bun scripts/verify-m029-s04.ts"`
- Exit code 0

---

### TC-02: Test suite passes with 0 failures

**Goal:** All 51 tests in the harness test file pass.

**Steps:**
1. `bun test ./scripts/verify-m029-s04.test.ts`

**Expected outcome:**
- `51 pass, 0 fail` in output
- Exit code 0
- No tests report `skip` (all 51 are executable without infra)

---

### TC-03: Check ID contract enforced

**Goal:** The harness exports exactly 5 check IDs in the correct order.

**Steps:**
1. Run `bun test ./scripts/verify-m029-s04.test.ts --reporter verbose 2>&1 | grep "Check ID contract"`

**Expected outcome:**
- `Check ID contract > M029_S04_CHECK_IDS has exactly 5 entries` — pass
- `Check ID contract > check IDs are in the correct order` — pass
- IDs are: `M029-S04-CONTENT-FILTER-REJECTS`, `M029-S04-PROMPT-BANS-META`, `M029-S04-NO-REASONING-IN-DB`, `M029-S04-LIVE-PUBLISHED`, `M029-S04-ISSUE-CLEAN`

---

### TC-04: Pure-code checks pass without DB or GitHub

**Goal:** `CONTENT-FILTER-REJECTS` and `PROMPT-BANS-META` never skip and always produce `passed: true` with real production code.

**Steps:**
1. `bun run verify:m029:s04 --json 2>&1`

**Expected outcome:**
- JSON output with `"overallPassed": true`
- Check `M029-S04-CONTENT-FILTER-REJECTS`: `"passed": true`, `"skipped": false`, `"status_code": "content_filter_rejects"`, detail mentions `isReasoningProse(...)` returns `true`
- Check `M029-S04-PROMPT-BANS-META`: `"passed": true`, `"skipped": false`, `"status_code": "prompt_bans_meta"`, detail mentions `## Output Contract` and `Do NOT`
- Exit code 0

---

### TC-05: DB-gated checks skip gracefully when no DB available

**Goal:** `NO-REASONING-IN-DB` and `LIVE-PUBLISHED` skip (not fail) when `DATABASE_URL` is unset or unavailable.

**Steps:**
1. `DATABASE_URL="" bun run verify:m029:s04 --json 2>&1`
   *(or run without DATABASE_URL set in the environment)*

**Expected outcome:**
- Check `M029-S04-NO-REASONING-IN-DB`: `"passed": false`, `"skipped": true`, `"status_code": "db_unavailable"`
- Check `M029-S04-LIVE-PUBLISHED`: `"passed": false`, `"skipped": true`, `"status_code": "db_unavailable"`
- `"overallPassed": true` (skipped checks do not contribute to failure)
- Exit code 0

---

### TC-06: GitHub-gated check skips gracefully when no GitHub auth

**Goal:** `ISSUE-CLEAN` skips (not fails) when `GITHUB_APP_ID` or `GITHUB_PRIVATE_KEY` is unavailable.

**Steps:**
1. Run the harness without GitHub App credentials set.
2. `bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.id == "M029-S04-ISSUE-CLEAN")'`

**Expected outcome:**
- `"skipped": true`
- `"status_code": "github_unavailable"`
- `"overallPassed": true` (skipped check does not block overall pass)

---

### TC-07: NO-REASONING-IN-DB check passes after DB cleanup (live, requires DB)

**Goal:** After running the DB cleanup step from the runbook, no reasoning-prose rows exist in `wiki_update_suggestions`.

**Precondition:** DB accessible; operator has run Step 1 of the runbook (SQL cleanup of reasoning-prose rows).

**Steps:**
1. `bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.id == "M029-S04-NO-REASONING-IN-DB")'`

**Expected outcome:**
- `"passed": true`
- `"skipped": false`
- `"status_code": "no_reasoning_in_db"`
- `"detail"` contains `count=0`

**Manual cross-check SQL:**
```sql
SELECT COUNT(*) FROM wiki_update_suggestions
WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)';
-- Expected: 0
```

---

### TC-08: LIVE-PUBLISHED check passes after re-publication (live, requires DB)

**Goal:** After running re-generation and re-publication steps from the runbook, published suggestions exist in the DB.

**Precondition:** DB accessible; operator has run Steps 2 and 4 of the runbook (re-generation and re-publication).

**Steps:**
1. `bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.id == "M029-S04-LIVE-PUBLISHED")'`

**Expected outcome:**
- `"passed": true`
- `"skipped": false`
- `"status_code": "live_published"`
- `"detail"` contains `count=N` where N > 0

**Manual cross-check SQL:**
```sql
SELECT COUNT(*) FROM wiki_update_suggestions WHERE published_at IS NOT NULL;
-- Expected: > 0
```

---

### TC-09: ISSUE-CLEAN check passes after issue cleanup (live, requires GitHub)

**Goal:** After running the issue cleanup step from the runbook, all comments on xbmc/wiki issue #5 are either the summary table or properly-marked modification comments.

**Precondition:** GitHub App credentials available; operator has run Step 3 of the runbook (cleanup-wiki-issue.ts --no-dry-run).

**Steps:**
1. `bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.id == "M029-S04-ISSUE-CLEAN")'`

**Expected outcome:**
- `"passed": true`
- `"skipped": false`
- `"status_code": "issue_clean"`
- `"detail"` contains `violations=0`

---

### TC-10: Harness returns exit 1 when a non-skipped check fails (mock path)

**Goal:** Confirm that a failing non-skipped check produces exit code 1 and stderr output.

**Steps:**
1. In the test suite, verify: `bun test ./scripts/verify-m029-s04.test.ts --reporter verbose 2>&1 | grep "buildM029S04ProofHarness > returns exitCode: 1"`

**Expected outcome:**
- `buildM029S04ProofHarness > returns exitCode: 1 when CONTENT-FILTER-REJECTS fails` — pass
- `buildM029S04ProofHarness > returns exitCode: 1 when LIVE-PUBLISHED fails and emits stderr` — pass

---

### TC-11: Human-readable output mode works (non-JSON)

**Goal:** Without `--json`, the harness emits plain text (not raw JSON).

**Steps:**
1. `bun run verify:m029:s04 2>&1`

**Expected outcome:**
- Output is plain text (not a JSON object starting with `{`)
- Each check ID appears in the output with PASS/SKIP status
- Exit code 0

---

### TC-12: Baseline tests still pass (regression guard)

**Goal:** S04 additions do not break S01/S02 tests.

**Steps:**
1. `bun test src/knowledge/wiki-voice-validator.test.ts src/knowledge/wiki-voice-analyzer.test.ts src/knowledge/wiki-update-generator.test.ts`

**Expected outcome:**
- 88 pass, 0 fail
- Includes `isReasoningProse` tests (5 true-cases, 4 false-cases), `buildVoicePreservingPrompt > includes Output Contract section`, `MIN_HEURISTIC_SCORE > is set to 3`, and `createUpdateGenerator page selection` tests

---

### TC-13: Failure diagnostic command surfaces failing checks

**Goal:** The documented `jq` diagnostic command correctly surfaces failing checks.

**Steps:**
1. (Using test suite mock) Verify the harness test: `buildM029S04ProofHarness > emits JSON output when json: true`
2. Manual: `bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'`
   (In CI without DB/GitHub, the 3 skipped checks will appear since `passed: false` on skipped checks.)

**Expected outcome:**
- Test passes
- In the manual command, skipped checks show `"skipped": true` — distinguishable from genuinely failing checks by filtering on `skipped == false`
- The correct compound filter is: `jq '.checks[] | select(.passed == false and .skipped == false)'`

---

### TC-14: Ops runbook covers all 5 steps with exact commands

**Goal:** The runbook is complete and actionable.

**Steps:**
1. `cat docs/m029-s04-ops-runbook.md`

**Expected outcome:**
- File exists and is non-empty
- Contains 5 numbered steps corresponding to: DB cleanup, re-generation, issue cleanup, re-publication, proof verification
- Each step includes the exact `bun ...` command to run
- Includes a section listing required environment variables (`DATABASE_URL`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`)
- Includes a skip-vs-pass table explaining which checks are skipped vs. passing in each harness run state

---

## Edge Cases

| Scenario | Expected behavior |
|----------|------------------|
| `CONTENT-FILTER-REJECTS` receives text that starts with lowercase `"i'll"` | `isReasoningProse` is case-insensitive — returns true |
| `CONTENT-FILTER-REJECTS` receives text with `"I'll"` in the middle (not start) | Returns false — anchored pattern requires start-of-string match |
| `LIVE-PUBLISHED` receives DB result with count = 1 | Passes — threshold is > 0 (not ≥ some minimum N) |
| `NO-REASONING-IN-DB` receives DB result with count = 5 | Fails with `status_code: reasoning_rows_found`, detail includes `count=5` |
| `ISSUE-CLEAN` encounters paginated issue (> 100 comments) | Paginator iterates until a page returns < 100 comments; all pages checked for violations |
| `ISSUE-CLEAN` comment is the summary table (contains `# Wiki Modification Artifacts`) | Not a violation even without modification marker |
| Both DB checks receive a DB that throws on connection | Both skip with `status_code: db_unavailable`; `overallPassed` stays true |
| `overallPassed` when all 5 checks pass (live run) | `overallPassed: true`, exit 0, no stderr output |
| `overallPassed` when 2 pure-code pass and 3 infra-gated skip | `overallPassed: true`, exit 0 — this is the expected CI state |
