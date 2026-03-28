# S04 Research: Re-generation, Re-publication & Proof Harness

**Date:** 2026-03-21  
**Slice risk:** medium  
**Depends on:** S01 (done), S02 (done), S03 (done)

---

## Summary

S04 is the integration capstone: it wires the three completed slices into a verified, end-to-end state. The work has two distinct parts:

1. **Operational steps** (manual, one-time): DB cleanup of reasoning-prose rows → re-generation → issue cleanup → re-publication. These must happen in order and can fail for infra reasons (bad LLM output, GitHub auth issues). The operator runs them sequentially.

2. **Proof harness** (`scripts/verify-m029-s04.ts`): a 5-check JSON verifier in the M028-S04 pattern. Two checks are pure-code and always run; two are DB-gated; one is GitHub-gated. The harness is the deliverable that closes the milestone.

The implementation cost is low: S01–S03 delivered all the building blocks. The main risks are (a) ISSUE-CLEAN check design — GitHub auth injection for a verify harness is new in this codebase — and (b) understanding what "enough" published rows means for the LIVE-PUBLISHED threshold.

---

## What S01–S03 Delivered (Forward Intelligence)

### S01: `isReasoningProse` + Output Contract (done)

- `isReasoningProse(text: string): boolean` exported from `src/knowledge/wiki-voice-validator.ts` — trims input, matches `/^(I'll|Let me|I will|Looking at|I need to)/i`, returns true for reasoning starters.
- Step 1a in `generateWithVoicePreservation`: drops suggestion immediately with `{ suggestion: "", validationResult: { feedback: "Reasoning prose detected: suggestion dropped" } }`.
- `## Output Contract` section at the bottom of `buildVoicePreservingPrompt` (after `## Hard Constraints`) in `src/knowledge/wiki-voice-analyzer.ts`. Lists all five banned starters verbatim with `Do NOT` wording.
- Tests pass: 88 across 3 files, 0 fail.

**What harness checks can use:**
- `CONTENT-FILTER-REJECTS`: import `isReasoningProse` from `../src/knowledge/wiki-voice-validator.ts`, call it with `"I'll analyze the evidence from PR #27909"`, assert `true`.
- `PROMPT-BANS-META`: import `buildVoicePreservingPrompt` from `../src/knowledge/wiki-voice-analyzer.ts`, call with minimal inputs, assert output contains `"## Output Contract"` and one of the banned starters.

### S02: `MIN_HEURISTIC_SCORE = 3` in page selection (done)

- `export const MIN_HEURISTIC_SCORE = 3` added immediately after `MIN_OVERLAP_SCORE` in `src/knowledge/wiki-update-generator.ts`.
- Page-selection query (else-branch only) has `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}`.
- The `pageIds` branch bypasses this filter intentionally.
- Tests: 26 pass, 0 fail (24 pre-existing + 2 new: constant-value assert + SQL-capture assert).

**What harness checks can use:** none directly — S02 is purely a SQL shape change. The NO-REASONING-IN-DB check covers the downstream effect (no garbage rows in DB).

### S03: `scripts/cleanup-wiki-issue.ts` (done)

- New script, dry-run-safe (`--dry-run` default, `--no-dry-run` to execute).
- Uses `createGitHubApp` → `getRepoInstallationContext` → `getInstallationOctokit` for auth.
- Marker: `<!-- kodiai:wiki-modification:` (prefix, without closing `-->`).
- Default mode: deletes comments **lacking** the marker. `--delete-all`: deletes everything.
- Pagination: manual `for (let page = 1; ; page++)` loop, `per_page: 100`.
- Output: per-comment `[DRY RUN]`/`[DELETED]`/`[FAILED]` lines + `--- Summary ---` block.
- Live dry-run against xbmc/wiki issue #5 deferred to S04 execution.

**What harness checks can use:** ISSUE-CLEAN check must call GitHub API directly (not via this script) to list and inspect comments on issue #5.

---

## Proof Harness Design

### Pattern: M028-S04

The M028-S04 harness in `scripts/verify-m028-s04.ts` is the canonical template. Key structural elements to replicate exactly:

1. **Check type pattern:**
   ```typescript
   export type M029S04Check = {
     id: M029S04CheckId;
     passed: boolean;
     skipped: boolean;      // true when dep (DB, GitHub) unavailable
     status_code: string;
     detail?: string;
   };
   ```

2. **Evaluator function** `evaluateM029S04(opts?: { sql?, octokit? })` — runs all 5 checks in `Promise.all`, returns report.

3. **Entry point** `buildM029S04ProofHarness(opts?)` — tries DB connection from `DATABASE_URL`, tries GitHub auth if creds present, calls evaluator, emits JSON or human-readable, returns `{ exitCode }`.

4. **Skip semantics:** skipped checks are excluded from `overallPassed` gate. Pure-code checks never skip. DB-gated checks skip when no sql. GitHub-gated check skips when no octokit.

5. **CLI shape:** `bun scripts/verify-m029-s04.ts [--json]`, exits 0 when all non-skipped pass.

6. **Test file:** `scripts/verify-m029-s04.test.ts` — mirrors M028-S04 test structure with check-ID contract, envelope shape, per-check pass/fail/skip coverage, `overallPassed` semantics, harness entry-point tests.

### The 5 Checks

#### Check 1: CONTENT-FILTER-REJECTS (pure-code, always runs)

```typescript
import { isReasoningProse } from "../src/knowledge/wiki-voice-validator.ts";
const result = isReasoningProse("I'll analyze the evidence from PR #27909");
// assert result === true
```

Status codes: `content_filter_rejects` (pass), `content_filter_broken` (fail).

No mocking needed — `isReasoningProse` is deterministic and dependency-free.

#### Check 2: PROMPT-BANS-META (pure-code, always runs)

```typescript
import { buildVoicePreservingPrompt } from "../src/knowledge/wiki-voice-analyzer.ts";
const prompt = buildVoicePreservingPrompt({
  styleDescription: { styleText: "imperative", formattingElements: [], mediaWikiMarkup: [], tokenCount: 0, pageTitle: "Test", wikiConventions: { categories: [], interwikiLinks: [], navboxes: [], templates: [] } },
  exemplarSections: [],
  originalSection: "Original text",
  sectionHeading: "Test",
  diffEvidence: "PR #1 changed X",
});
// assert prompt.includes("## Output Contract") && prompt.includes("Do NOT")
```

Status codes: `prompt_bans_meta` (pass), `prompt_missing_contract` (fail).

**Important:** `buildVoicePreservingPrompt` takes a `PageStyleDescription` object. The type is defined in `src/knowledge/wiki-voice-types.ts`. The `wikiConventions` field (required) has `categories`, `interwikiLinks`, `navboxes`, `templates` arrays. Build a minimal valid object — no LLM or DB calls are made.

#### Check 3: NO-REASONING-IN-DB (DB-gated)

```sql
SELECT COUNT(*)::int AS cnt
FROM wiki_update_suggestions
WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'
```

Assert `cnt === 0`. Skip when no sql. Status codes: `no_reasoning_in_db` (pass), `reasoning_rows_found` (fail — include `count=N` in detail), `db_unavailable` (skip).

**Note on SQL:** The `~*` operator is PostgreSQL case-insensitive regex. The five patterns match exactly `isReasoningProse`'s `/^(I'll|Let me|I will|Looking at|I need to)/i` — the order differs from the regex but the semantics are the same. Single-quote escaping in postgres.js tagged templates: use `''` inside a string value passed as an interpolated parameter, not inline in the template string. Or pass the pattern as a parameter: `` sql`WHERE suggestion ~* ${'^(I''ll|Let me...)'}` ``.

**Postgres.js tagged template note:** The M028 harness uses the standard tagged-template call pattern for the sql stub: `sql` is called as a tagged template and returns `Promise<unknown[]>`. The mock stub in tests is a plain function that ignores args and returns canned rows. Use the exact same pattern from `verify-m028-s04.ts`.

#### Check 4: LIVE-PUBLISHED (DB-gated)

```sql
SELECT COUNT(*)::int AS cnt
FROM wiki_update_suggestions
WHERE published_at IS NOT NULL
```

Assert `cnt > 0` (at least one published row). M028's threshold was `>= 80` because re-publishing the full corpus was expected; M029's re-generation may produce fewer pages given the heuristic threshold. Use `cnt > 0` not `cnt >= 80`. Status codes: `live_published` (pass), `no_published_rows` (fail), `db_unavailable` (skip).

**Design choice:** The roadmap says `count must be > 0`. Do NOT reuse M028's `>= 80` threshold — M029 generates only pages with `heuristic_score >= 3`, which likely produces far fewer rows than the pre-filter run.

#### Check 5: ISSUE-CLEAN (GitHub-gated)

The roadmap spec: "query GitHub API to list comments on issue #5; assert zero comments lack the `<!-- kodiai:wiki-modification: -->` marker (i.e., all non-summary-table comments are properly marked modification comments)."

**Implementation approach:**

The harness receives an optional `octokit: Octokit | undefined` parameter. When `undefined`, the check skips with `github_unavailable`. When provided, it paginates through all comments on issue #5 using `octokit.rest.issues.listComments` (same pagination as cleanup-wiki-issue.ts).

A comment is "clean" if `body.includes("<!-- kodiai:wiki-modification:")`. The summary table comment will also need to pass — it does not have this marker. Decision needed: should the summary table comment be treated as an exception?

**Options for the summary table:**
- Option A: Treat the summary table comment as a "clean" exception by checking if the body contains `# Wiki Modification Artifacts` (the formatSummaryTable header). Clean = has modification marker OR is the summary table.
- Option B: Require the summary table marker too (not practical — it has no such marker).
- Option C: Only check that zero comments match "has no marker AND is not the summary table". This is the most accurate implementation of the spec.

**Recommended:** Option C — a comment is a violation if it lacks the marker AND does not contain the summary table header (`# Wiki Modification Artifacts`). Count violations; assert `violations === 0`.

Status codes: `issue_clean` (pass), `unmarked_comments_found` (fail — include `count=N violations` in detail), `github_unavailable` (skip).

**GitHub auth injection in the harness:**

Unlike DB auth (try `DATABASE_URL` env), GitHub App auth for a verify harness requires `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY`. The harness should:
1. Accept an optional `octokit` parameter in `buildM029S04ProofHarness`.
2. If not provided, attempt to build one from env vars by calling `createGitHubApp` → `getRepoInstallationContext("xbmc", "wiki")` → `getInstallationOctokit`.
3. Wrap the auth attempt in try/catch — if it fails (missing env vars, no installation), pass `undefined` to evaluateM029S04 and the check skips.

This mirrors how the DB connection is handled: try from env, fall back to skip.

```typescript
// In buildM029S04ProofHarness:
let octokit: Octokit | undefined = opts?.octokit;
if (octokit === undefined && process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY) {
  try {
    const app = createGitHubApp(minimalAppConfig, silentLogger);
    await app.initialize();
    const context = await app.getRepoInstallationContext("xbmc", "wiki");
    if (context) {
      octokit = await app.getInstallationOctokit(context.installationId);
    }
  } catch { /* skip */ }
}
```

The minimal `AppConfig` for `createGitHubApp` follows the pattern in `cleanup-wiki-issue.ts` — fill all non-GitHub fields with `"unused"` stubs. The same AppConfig shape is used in `scripts/publish-wiki-updates.ts` too.

**Test coverage for ISSUE-CLEAN:** Mock the octokit by injecting an object with `rest.issues.listComments` that returns canned comment arrays. Test: skip when no octokit; pass when all comments have marker; fail when one comment lacks marker (and is not summary table).

---

## Implementation Landscape

### Files to create

1. **`scripts/verify-m029-s04.ts`** — proof harness (~200 lines)
   - Exports: `M029_S04_CHECK_IDS`, `M029S04Check`, `M029S04CheckId`, `M029S04EvaluationReport`, `evaluateM029S04`, `buildM029S04ProofHarness`
   - Imports: `isReasoningProse` from `../src/knowledge/wiki-voice-validator.ts`; `buildVoicePreservingPrompt` from `../src/knowledge/wiki-voice-analyzer.ts`; `createGitHubApp` from `../src/auth/github-app.ts`; `createDbClient` from `../src/db/client.ts`
   - Pattern: M028-S04 exactly — pure function evaluator, harness entry point, CLI runner with `import.meta.main`

2. **`scripts/verify-m029-s04.test.ts`** — test suite (~150 lines)
   - Pattern: M028-S04 test structure
   - Groups: Check ID contract, Envelope shape, per-check tests (5 groups), overallPassed semantics, buildM029S04ProofHarness

### Files to modify

1. **`package.json`** — add `"verify:m029:s04": "bun scripts/verify-m029-s04.ts"` to `scripts`

### Operational steps (not code changes)

These are executed by the operator during S04, not automated by the harness:

1. **DB cleanup:** `DELETE FROM wiki_update_suggestions WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'`
2. **Re-generation:** `bun scripts/generate-wiki-updates.ts` (uses fixed prompt + content filter + heuristic threshold now active)
3. **Issue cleanup:** `bun scripts/cleanup-wiki-issue.ts --owner xbmc --repo wiki --issue-number 5 --no-dry-run`
4. **Re-publication:** `bun scripts/publish-wiki-updates.ts --issue-number 5`
5. **Proof verification:** `bun run verify:m029:s04 --json`

---

## Key Imports and Types

### `PageStyleDescription` (needed for PROMPT-BANS-META test)

From `src/knowledge/wiki-voice-types.ts`:
```typescript
export type PageStyleDescription = {
  pageTitle: string;
  styleText: string;
  formattingElements: string[];
  mediaWikiMarkup: string[];
  tokenCount: number;
  wikiConventions: {
    categories: string[];
    interwikiLinks: string[];
    navboxes: string[];
    templates: string[];
  };
};
```

Confirmed: `wikiConventions` is required (no `?`). Build a minimal valid instance for the pure-code test with empty arrays.

### `buildVoicePreservingPrompt` opts shape

```typescript
opts: {
  styleDescription: PageStyleDescription;
  exemplarSections: StyleExemplar[];  // can be []
  originalSection: string;
  sectionHeading: string | null;
  diffEvidence: string;
}
```

### Octokit mock for ISSUE-CLEAN test

```typescript
// Minimal mock for testing:
function makeOctokitStub(comments: Array<{ id: number; body: string }>): unknown {
  return {
    rest: {
      issues: {
        listComments: async ({ page }: { page: number }) =>
          page === 1 ? { data: comments } : { data: [] },
      },
    },
  };
}
```

The pagination loop in the harness should mirror cleanup-wiki-issue.ts: `for (let page = 1; ; page++)` with `per_page: 100`, break when `data.length < 100`.

---

## Constraints and Risks

### Risk 1: ISSUE-CLEAN marker logic

The cleanup script (S03) deletes non-marked comments. After re-publication, the issue should contain: one summary table comment + N modification comments (each with `<!-- kodiai:wiki-modification:NNN -->`). The summary table body starts with `# Wiki Modification Artifacts` — confirmed from `formatSummaryTable` in `wiki-publisher.ts`. The harness must exclude the summary table from the violation count or it will always fail.

### Risk 2: DB cleanup SQL escaping

`'I''ll'` (double single-quote) is correct PostgreSQL escaping for `I'll` inside a single-quoted string literal. In a postgres.js tagged template parameter, pass the regex pattern as an interpolated value — postgres.js handles escaping automatically. The safest approach: pass the pattern as a parameter, not inline in the template string.

```typescript
const pattern = "^(I'll|Let me|I will|I need to|Looking at)";
const rows = await sql`
  SELECT COUNT(*)::int AS cnt
  FROM wiki_update_suggestions
  WHERE suggestion ~* ${pattern}
`;
```

### Risk 3: LIVE-PUBLISHED threshold

The check must use `count > 0`, not `count >= 80`. Post-re-generation, the number of grounded suggestions depends on how many pages pass `heuristic_score >= 3` AND have sections that survive `isReasoningProse`. Under the new filter, several pages that were previously published may now produce zero accepted suggestions. The exact count is unknown without a live run — `> 0` is the right threshold.

### Risk 4: createDbClient throws on missing DATABASE_URL

`createDbClient` throws synchronously when `DATABASE_URL` is missing. The M028-S04 harness wraps the DB probe in `try/catch`. Do the same — wrap the entire `createDbClient` + probe query in try/catch, fall back to `sql = undefined`.

```typescript
let sql: unknown = opts?.sql;
if (sql === undefined) {
  try {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      const { createDbClient } = await import("../src/db/client.ts");
      const client = createDbClient({ connectionString: dbUrl, logger: createSilentLogger() });
      sql = client.sql;
      await (client.sql as any)`SELECT 1`; // probe
    }
  } catch { sql = undefined; }
}
```

This is copied exactly from `verify-m028-s04.ts`'s `buildM028S04ProofHarness`.

---

## Verification

### Pure-code tests (run in CI without DB/GitHub):
```
bun test scripts/verify-m029-s04.test.ts
```
All 5 check behaviors must be testable with mocks. The 3 pure-code checks have no external deps. The 2 DB-gated checks use the sql-stub pattern from M028. The 1 GitHub-gated check uses the octokit mock pattern described above.

### Full verification (requires live DB + GitHub):
```
bun run verify:m029:s04 --json
```
Exit 0 with `overallPassed: true` after the operational steps complete.

### Unit test baseline must not regress:
```
bun test src/knowledge/wiki-voice-validator.test.ts src/knowledge/wiki-voice-analyzer.test.ts src/knowledge/wiki-update-generator.test.ts
```
Currently: 88 pass, 0 fail. S04 adds no changes to these files.

---

## Recommendation for Planner

**One task is sufficient.** S04 has two outputs:
1. `scripts/verify-m029-s04.ts` + `scripts/verify-m029-s04.test.ts` — code
2. `package.json` — one-line addition

The harness is structurally identical to M028-S04 with different check implementations. An executor that reads `verify-m028-s04.ts` and `verify-m028-s04.test.ts` as the template will be able to implement all 5 checks in a single task.

**Build order within the task:**
1. Write `verify-m029-s04.ts` (pure-code checks first, then DB checks, then GitHub check)
2. Write `verify-m029-s04.test.ts`
3. Run `bun test scripts/verify-m029-s04.test.ts` — must pass without DB/GitHub
4. Add `verify:m029:s04` to `package.json`
5. Run `bun run verify:m029:s04` (without DB) — must exit 0 with 2 pure-code passes + 3 skips

The operational steps (DB cleanup, re-generation, cleanup, re-publication) are separate from the code task and require live infrastructure. Document them in the task plan as operator instructions, not automated code.
