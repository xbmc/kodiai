---
estimated_steps: 5
estimated_files: 4
skills_used:
  - review
---

# T01: Implement M029-S04 proof harness, tests, package.json entry, and ops runbook

**Slice:** S04 — Re-generation, Re-publication & Proof Harness
**Milestone:** M029

## Description

Build the M029-S04 proof harness that verifies the assembled M029 pipeline (S01 prompt fix + content filter, S02 heuristic threshold, S03 issue cleanup) produced correct output. The harness pattern matches `scripts/verify-m028-s04.ts` exactly: exported types, an `evaluateM029S04` function, a `buildM029S04ProofHarness` entry point, and a CLI runner with `import.meta.main`.

The harness has 5 checks:
1. **CONTENT-FILTER-REJECTS** (pure-code) — `isReasoningProse("I'll analyze the evidence from PR #27909")` returns `true`
2. **PROMPT-BANS-META** (pure-code) — `buildVoicePreservingPrompt(...)` output contains `"## Output Contract"` and `"Do NOT"`
3. **NO-REASONING-IN-DB** (DB-gated) — `COUNT(*) = 0` for rows where `suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'`
4. **LIVE-PUBLISHED** (DB-gated) — `COUNT(*) > 0` for rows where `published_at IS NOT NULL`
5. **ISSUE-CLEAN** (GitHub-gated) — zero comments on issue #5 lack the `<!-- kodiai:wiki-modification:` marker AND are not the summary table (identified by containing `# Wiki Modification Artifacts`)

Also add the `verify:m029:s04` npm script entry to `package.json` and write `docs/m029-s04-ops-runbook.md` documenting the 5 operational steps an operator must run before the harness can produce a full live pass.

## Steps

1. **Read `scripts/verify-m028-s04.ts` and `scripts/verify-m028-s04.test.ts`** — use these as the structural template. Note: the M029 harness differs in: (a) 5 different check IDs, (b) no `_formatFn`/`_summaryFn` params, (c) new `octokit` injection path for ISSUE-CLEAN, (d) LIVE-PUBLISHED uses `COUNT(*) > 0` threshold not `>= 80`, (e) two pure-code checks use imports from S01 files.

2. **Write `scripts/verify-m029-s04.ts`** with this exact shape:

   **Types:**
   ```typescript
   export const M029_S04_CHECK_IDS = [
     "M029-S04-CONTENT-FILTER-REJECTS",
     "M029-S04-PROMPT-BANS-META",
     "M029-S04-NO-REASONING-IN-DB",
     "M029-S04-LIVE-PUBLISHED",
     "M029-S04-ISSUE-CLEAN",
   ] as const;
   export type M029S04CheckId = (typeof M029_S04_CHECK_IDS)[number];
   export type M029S04Check = { id: M029S04CheckId; passed: boolean; skipped: boolean; status_code: string; detail?: string; };
   export type M029S04EvaluationReport = { check_ids: readonly string[]; overallPassed: boolean; checks: M029S04Check[]; };
   ```

   **Check 1 — CONTENT-FILTER-REJECTS (pure-code):**
   ```typescript
   import { isReasoningProse } from "../src/knowledge/wiki-voice-validator.ts";
   const result = isReasoningProse("I'll analyze the evidence from PR #27909");
   // pass: status_code = "content_filter_rejects"
   // fail: status_code = "content_filter_broken"
   ```

   **Check 2 — PROMPT-BANS-META (pure-code):**
   ```typescript
   import { buildVoicePreservingPrompt } from "../src/knowledge/wiki-voice-analyzer.ts";
   import type { PageStyleDescription } from "../src/knowledge/wiki-voice-types.ts";
   const styleDescription: PageStyleDescription = {
     pageTitle: "Test", styleText: "imperative", formattingElements: [], mediaWikiMarkup: [],
     tokenCount: 0, wikiConventions: { categories: [], interwikiLinks: [], navboxes: [], templates: [] },
   };
   const prompt = buildVoicePreservingPrompt({ styleDescription, exemplarSections: [], originalSection: "Original", sectionHeading: "Test", diffEvidence: "PR #1 changed X" });
   // pass: prompt.includes("## Output Contract") && prompt.includes("Do NOT")  → status_code = "prompt_bans_meta"
   // fail: status_code = "prompt_missing_contract"
   ```

   **Check 3 — NO-REASONING-IN-DB (DB-gated):**
   ```typescript
   // Skip when !sql → status_code = "db_unavailable"
   const pattern = "^(I'll|Let me|I will|I need to|Looking at)";
   const rows = await sql`SELECT COUNT(*)::int AS cnt FROM wiki_update_suggestions WHERE suggestion ~* ${pattern}`;
   const cnt = rows[0]?.cnt ?? 0;
   // cnt === 0 → pass, status_code = "no_reasoning_in_db"
   // cnt > 0  → fail, status_code = "reasoning_rows_found", detail = `count=${cnt}`
   ```

   **Check 4 — LIVE-PUBLISHED (DB-gated):**
   ```typescript
   // Skip when !sql → status_code = "db_unavailable"
   const rows = await sql`SELECT COUNT(*)::int AS cnt FROM wiki_update_suggestions WHERE published_at IS NOT NULL`;
   const cnt = rows[0]?.cnt ?? 0;
   // cnt > 0  → pass, status_code = "live_published", detail = `count=${cnt}`
   // cnt === 0 → fail, status_code = "no_published_rows"
   ```

   **Check 5 — ISSUE-CLEAN (GitHub-gated):**
   ```typescript
   // Skip when !octokit → status_code = "github_unavailable"
   // Paginate: for (let page = 1; ; page++) with per_page: 100, break when data.length < 100
   // A comment is a violation if: !body.includes("<!-- kodiai:wiki-modification:") && !body.includes("# Wiki Modification Artifacts")
   // violations === 0 → pass, status_code = "issue_clean"
   // violations > 0  → fail, status_code = "unmarked_comments_found", detail = `violations=${violations}`
   ```

   **`evaluateM029S04(opts?: { sql?, octokit? })` — runs all 5 checks with `Promise.all`, returns report. `overallPassed = checks.filter(c => !c.skipped).every(c => c.passed)`.**

   **`buildM029S04ProofHarness(opts?)` — try DB from `DATABASE_URL`, try GitHub auth if `GITHUB_APP_ID`+`GITHUB_PRIVATE_KEY` present. Both wrapped in try/catch with skip fallback. CLI runner with `import.meta.main`.**

   **GitHub auth in harness (wrap in try/catch, skip if fails):**
   ```typescript
   import { createGitHubApp } from "../src/auth/github-app.ts";
   // Build a minimal AppConfig — see scripts/cleanup-wiki-issue.ts for the exact shape
   // call app.initialize(), app.getRepoInstallationContext("xbmc", "wiki"), app.getInstallationOctokit(context.installationId)
   ```
   Read `scripts/cleanup-wiki-issue.ts` to get the exact AppConfig shape and auth call sequence before implementing.

3. **Write `scripts/verify-m029-s04.test.ts`** — mirror M028-S04 test structure. Groups:
   - Check ID contract (5 IDs, exact names, correct order)
   - Envelope shape (check_ids, overallPassed, checks with 5 entries)
   - CONTENT-FILTER-REJECTS: always passes with real import; fails when mock check forces false
   - PROMPT-BANS-META: always passes with real imports; fails when mock forces missing contract
   - NO-REASONING-IN-DB: skip when sql=undefined; pass when count=0; fail when count=5; skip when sql throws
   - LIVE-PUBLISHED: skip when sql=undefined; pass when count=3; fail when count=0; skip when sql throws
   - ISSUE-CLEAN: skip when octokit=undefined; pass when all comments have marker or are summary table; fail when one comment lacks marker and is not summary table
   - overallPassed semantics: all non-skipped pass → true; any fail → false; skipped don't gate
   - buildM029S04ProofHarness: exitCode 0 when all pure-code pass + DB/GitHub skipped; exitCode 1 when a check fails; JSON output shape; human-readable output shape

   **Octokit mock for ISSUE-CLEAN tests:**
   ```typescript
   function makeOctokitStub(pages: Array<Array<{ id: number; body: string }>>) {
     return {
       rest: {
         issues: {
           listComments: async ({ page }: { owner: string; repo: string; issue_number: number; per_page: number; page: number }) =>
             ({ data: pages[page - 1] ?? [] }),
         },
       },
     };
   }
   ```

   **SQL mock pattern (from M028-S04 tests):** Use `makeSqlStub` (returns same rows for all calls) and `makeSequentialSqlStub` (different rows per call index) — copy the exact helper implementations from `scripts/verify-m028-s04.test.ts`.

4. **Update `package.json`** — add `"verify:m029:s04": "bun scripts/verify-m029-s04.ts"` immediately after the existing `"verify:m028:s04"` entry in the `scripts` block.

5. **Write `docs/m029-s04-ops-runbook.md`** documenting these 5 steps with exact commands:
   - Step 1 (DB cleanup): `psql $DATABASE_URL -c "DELETE FROM wiki_update_suggestions WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'"` — deletes reasoning-prose rows
   - Step 2 (Re-generation): `bun scripts/generate-wiki-updates.ts` — uses fixed prompt + content filter + heuristic threshold (heuristic_score >= 3)
   - Step 3 (Issue cleanup): `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --dry-run` then `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --no-dry-run`
   - Step 4 (Re-publication): `bun scripts/publish-wiki-updates.ts --issue-number 5`
   - Step 5 (Proof): `bun run verify:m029:s04 --json`
   Include a note on skip vs. pass: pure-code checks always run; DB checks require `DATABASE_URL`; ISSUE-CLEAN requires `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY`.

## Must-Haves

- [ ] `scripts/verify-m029-s04.ts` exports `M029_S04_CHECK_IDS`, `M029S04Check`, `M029S04CheckId`, `M029S04EvaluationReport`, `evaluateM029S04`, `buildM029S04ProofHarness`
- [ ] `M029_S04_CHECK_IDS` has exactly 5 entries in the order: CONTENT-FILTER-REJECTS, PROMPT-BANS-META, NO-REASONING-IN-DB, LIVE-PUBLISHED, ISSUE-CLEAN
- [ ] CONTENT-FILTER-REJECTS passes with real `isReasoningProse` import (no DB, no GitHub)
- [ ] PROMPT-BANS-META passes with real `buildVoicePreservingPrompt` import (no DB, no GitHub)
- [ ] NO-REASONING-IN-DB uses parameterized SQL pattern (not inline string); skips when no sql; passes when count=0; fails when count>0
- [ ] LIVE-PUBLISHED uses threshold `cnt > 0` (NOT `>= 80`); skips when no sql; passes when count>0; fails when count=0
- [ ] ISSUE-CLEAN skips when no octokit; violation check is: lacks marker AND is not summary table; pagination uses `for (let page = 1; ; page++)` with break on `data.length < 100`
- [ ] `evaluateM029S04` uses `Promise.all` for all 5 checks; `overallPassed` excludes skipped checks
- [ ] `buildM029S04ProofHarness` wraps DB probe in try/catch; wraps GitHub auth in try/catch; accepts `stdout`, `stderr`, `json` opts
- [ ] `scripts/verify-m029-s04.test.ts` passes `bun test scripts/verify-m029-s04.test.ts` with 0 failures
- [ ] `package.json` has `"verify:m029:s04": "bun scripts/verify-m029-s04.ts"` in scripts block
- [ ] `docs/m029-s04-ops-runbook.md` documents all 5 operational steps with exact commands

## Verification

- `bun test scripts/verify-m029-s04.test.ts` — exits 0, 0 failures
- `grep '"verify:m029:s04"' package.json` — finds the entry
- `bun run verify:m029:s04 --json 2>&1 | head -5` — emits valid JSON with `overallPassed` field (pure-code checks pass even without DB/GitHub)
- `bun test src/knowledge/wiki-voice-validator.test.ts src/knowledge/wiki-voice-analyzer.test.ts src/knowledge/wiki-update-generator.test.ts` — 0 failures (regression guard; S04 doesn't modify these files)

## Inputs

- `scripts/verify-m028-s04.ts` — canonical pattern template: types, evaluator, harness entry point, DB probe, CLI runner
- `scripts/verify-m028-s04.test.ts` — canonical test template: sql stubs, helper functions, all group structures
- `scripts/cleanup-wiki-issue.ts` — AppConfig shape and auth call sequence for GitHub auth injection
- `src/knowledge/wiki-voice-validator.ts` — exports `isReasoningProse` (S01 deliverable)
- `src/knowledge/wiki-voice-analyzer.ts` — exports `buildVoicePreservingPrompt` (S01 deliverable)
- `src/knowledge/wiki-voice-types.ts` — `PageStyleDescription` type for PROMPT-BANS-META check
- `package.json` — add verify script entry after `"verify:m028:s04"` line

## Expected Output

- `scripts/verify-m029-s04.ts` — proof harness with 5 checks, evaluator, harness entry point, CLI runner
- `scripts/verify-m029-s04.test.ts` — test suite with all 5 check behaviors covered via mocks
- `package.json` — updated with `verify:m029:s04` script entry
- `docs/m029-s04-ops-runbook.md` — operational runbook with exact commands for all 5 pre-verification steps
