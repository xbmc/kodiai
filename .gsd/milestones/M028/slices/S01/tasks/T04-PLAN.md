---
estimated_steps: 5
estimated_files: 3
---

# T04: Verifier Script, Test, and Package.json Wiring

**Slice:** S01 — Modification Artifact Contract Through Real Entry Points
**Milestone:** M028

## Description

Lock the modification-only contract machine-checkably using the M027 verifier pattern: stable check IDs, raw evidence envelope, JSON-first CLI, and a test harness that validates evaluator behavior without requiring a live database. Two checks run in every environment (pure-code); two checks run only when `DATABASE_URL` is available.

## Steps

1. Write `scripts/verify-m028-s01.ts`. Export:
   - `M028_S01_CHECK_IDS = ["M028-S01-ARTIFACT-CONTRACT", "M028-S01-NO-WHY-IN-RENDER", "M028-S01-PR-CITATIONS", "M028-S01-MODE-FIELD"] as const`
   - `type M028S01CheckId`
   - `type M028S01Check = { id, passed, status_code, detail }`
   - `type M028S01EvaluationReport = { check_ids, overallPassed, status_code, checks, pure_code_evidence, db_evidence? }`
   - `type M028S01ProofHarnessReport = M028S01EvaluationReport & { command, generated_at, success }`

   Check implementations:
   - **M028-S01-NO-WHY-IN-RENDER** (pure-code, always runs): construct a `PageSuggestionGroup` with `modificationMode: 'section'`, a suggestion with `replacementContent: "The audio pipeline now routes through PipeWire (PR #27901)."`, and `citingPrs: [{ prNumber: 27901, prTitle: "Switch to PipeWire" }]`. Call `formatPageComment(group, "xbmc", "xbmc")`. Check that the result contains neither `"WHY:"` nor `"**Why:**"`. `status_code: 'no_why_in_render'` on pass, `'why_found_in_render'` on fail.
   - **M028-S01-PR-CITATIONS** (pure-code, always runs): using the same group from above, check that `result.includes("https://github.com/")`. `status_code: 'pr_citations_present'` on pass, `'no_pr_citations'` on fail.
   - **M028-S01-ARTIFACT-CONTRACT** (DB-gated): query `SELECT COUNT(*) FROM wiki_update_suggestions WHERE modification_mode IS NOT NULL AND replacement_content IS NOT NULL AND generated_at > NOW() - INTERVAL '7 days'`. Pass if count > 0. If `DATABASE_URL` absent, `status_code: 'db_unavailable'`, `passed: true` (not a failure — just not verified). If count = 0, `status_code: 'no_new_artifacts'`, `passed: false` with detail "Run generate-wiki-updates.ts to create new artifacts with the modification contract."
   - **M028-S01-MODE-FIELD** (DB-gated): query `SELECT COUNT(*) FROM wiki_update_suggestions WHERE modification_mode IN ('section', 'page')`. Pass if count > 0. Same DB-unavailable handling.

   `evaluateM028S01(opts: { sql?: Sql }): Promise<M028S01EvaluationReport>` — runs all four checks. `buildM028S01ProofHarness(opts): Promise<M028S01ProofHarnessReport>` — calls evaluate and wraps in the report envelope.

   CLI runner at bottom: parse `--json`, `--help`. When `DATABASE_URL` is set, create DB client and pass sql; otherwise pass `sql: undefined`. Print JSON or human-readable summary. Human summary shows each check ID, PASS/FAIL, and status code.

2. Write `scripts/verify-m028-s01.test.ts`. Import `evaluateM028S01`, `M028_S01_CHECK_IDS`, `formatPageComment`. Tests:
   - `M028_S01_CHECK_IDS` has exactly four entries
   - `evaluateM028S01({ sql: undefined })` resolves; pure-code checks (NO-WHY-IN-RENDER, PR-CITATIONS) are present and passing in the result
   - `evaluateM028S01` with a fixture group containing `"**Why:** reason"` in replacementContent: M028-S01-NO-WHY-IN-RENDER check fails (the WHY: text is in the replacementContent which gets rendered — catch this regression path)
   - Wait: actually the check calls `formatPageComment` internally. If `formatPageComment` is correctly rewritten (T03), it will never emit `**Why:**` regardless of what's in `replacementContent`. So the regression test should verify that if someone adds `**Why:** ${s.something}` back to `formatPageComment`, the check catches it. Test this by mocking `formatPageComment` to return a string containing `"**Why:** reason"` and verifying the check fails. OR: test it at the content level — the check's raw formatted output is in `pure_code_evidence`; assert it does not contain `**Why:**`.
   - Envelope shape: result has `check_ids` array, `overallPassed` boolean, `checks` array with four items, `pure_code_evidence` with NO-WHY-IN-RENDER and PR-CITATIONS raw outputs
   - DB check with `sql: undefined` returns `status_code: 'db_unavailable'` for ARTIFACT-CONTRACT and MODE-FIELD
   - `overallPassed` is true when DB is unavailable (DB checks count as non-failures when DB is absent)

3. Add `"verify:m028:s01": "bun scripts/verify-m028-s01.ts"` to `package.json` scripts section (alongside the existing `verify:m027:*` entries).

4. Run `bun test scripts/verify-m028-s01.test.ts` and confirm all pass. Run `bun run verify:m028:s01` (without DB) and confirm the pure-code checks pass and DB checks report `db_unavailable`.

5. Run `bunx tsc --noEmit` and confirm no TypeScript errors.

## Must-Haves

- [ ] `scripts/verify-m028-s01.ts` exports `M028_S01_CHECK_IDS`, `evaluateM028S01`, `buildM028S01ProofHarness`
- [ ] M028-S01-NO-WHY-IN-RENDER check runs without DB and passes when `formatPageComment` is modification-only
- [ ] M028-S01-PR-CITATIONS check runs without DB and passes when PR citation links are present
- [ ] M028-S01-ARTIFACT-CONTRACT and M028-S01-MODE-FIELD report `db_unavailable` (not failure) when `DATABASE_URL` is absent
- [ ] `scripts/verify-m028-s01.test.ts` passes with check ID coverage and envelope shape assertions
- [ ] `"verify:m028:s01"` script alias in `package.json`
- [ ] `bunx tsc --noEmit` exits 0

## Verification

- `bun test scripts/verify-m028-s01.test.ts` — all tests pass
- `bun run verify:m028:s01` — exits 0; output shows M028-S01-NO-WHY-IN-RENDER PASS and M028-S01-PR-CITATIONS PASS
- `bun run verify:m028:s01 --json` — emits valid JSON with `check_ids` array containing all four IDs
- `bunx tsc --noEmit` exits 0

## Inputs

- `src/knowledge/wiki-publisher.ts` (T03 output) — `formatPageComment` with modification-only output
- `src/knowledge/wiki-publisher-types.ts` (T03 output) — `PageSuggestionGroup` with `replacementContent`, `modificationMode`
- `scripts/verify-m027-s03.ts` — structural template for check IDs, envelope shape, evaluator pattern, CLI runner pattern

## Expected Output

- `scripts/verify-m028-s01.ts` — verifier with four check IDs, two pure-code checks, two DB-gated checks, JSON-first CLI
- `scripts/verify-m028-s01.test.ts` — test coverage for check IDs, envelope shape, pure-code check behavior, DB-unavailable handling
- `package.json` — `verify:m028:s01` alias added
