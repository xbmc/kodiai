# S02 Research — Heuristic Score Threshold in Page Selection

**Slice:** S02 — Heuristic Score Threshold in Page Selection  
**Risk:** Low  
**Date:** 2026-03-21

## Summary

This is straightforward, well-understood work. The change is a single SQL clause and one new named constant in `wiki-update-generator.ts`. The test is a new additive test using a captured-SQL mock pattern that already exists in the codebase. No external dependencies, no library lookups needed.

The only nuance: `createUpdateGenerator` is not currently tested (only its pure helper functions are). Adding the new test requires constructing a minimal mock of `UpdateGeneratorOptions` — the mock shape for all required fields is already established in `wiki-staleness-detector.test.ts` and can be copied directly.

## Recommendation

Implement in one commit:
1. Add `export const MIN_HEURISTIC_SCORE = 3` at line 38 alongside `MIN_OVERLAP_SCORE`
2. Add `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` to the page-selection query
3. Add two new tests to `wiki-update-generator.test.ts`: constant-value test + SQL-capture test

## Implementation Landscape

### File: `src/knowledge/wiki-update-generator.ts`

**Constants block (line 35-40):**
```ts
/** Minimum non-stopword token overlap to include a patch. */
const MIN_OVERLAP_SCORE = 2;
```
→ Add immediately after this:
```ts
/** Minimum heuristic score for PR evidence to qualify a page for selection. */
export const MIN_HEURISTIC_SCORE = 3;
```

`MIN_OVERLAP_SCORE` is currently non-exported. `MIN_HEURISTIC_SCORE` should be **exported** so it can be directly asserted in the test without SQL capture. Decision D007/D008 documents this value and explicitly marks it revisable.

**Page-selection query (lines 379–387):**
```ts
const rows = await opts.sql`
  SELECT DISTINCT wpp.page_id, wpp.page_title, wpp.composite_score
  FROM wiki_page_popularity wpp
  INNER JOIN wiki_pr_evidence wpe ON wpe.matched_page_id = wpp.page_id
  ORDER BY wpp.composite_score DESC
  LIMIT ${topN}
`;
```
→ Add `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` before `ORDER BY`:
```ts
const rows = await opts.sql`
  SELECT DISTINCT wpp.page_id, wpp.page_title, wpp.composite_score
  FROM wiki_page_popularity wpp
  INNER JOIN wiki_pr_evidence wpe ON wpe.matched_page_id = wpp.page_id
  WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}
  ORDER BY wpp.composite_score DESC
  LIMIT ${topN}
`;
```

There is a second SQL call in `processPage` that fetches PR evidence (lines 491–498) — this one does NOT need a `heuristic_score` filter. The filter belongs only at the **page-selection** level. Evidence fetch for an already-selected page keeps all evidence for that page.

### File: `src/knowledge/wiki-update-generator.test.ts`

**Current state:** Tests only pure exported functions: `matchPatchesToSection`, `buildGroundedSectionPrompt`, `parseGeneratedSuggestion`, `checkGrounding`. No test for `createUpdateGenerator` exists.

**Two new tests to add:**

**Test 1 — Constant value assertion** (trivial, deterministic):
```ts
import { MIN_HEURISTIC_SCORE } from "./wiki-update-generator.ts";

describe("MIN_HEURISTIC_SCORE", () => {
  it("is set to 3 (High relevance threshold)", () => {
    expect(MIN_HEURISTIC_SCORE).toBe(3);
  });
});
```
This test fails immediately if the constant regresses.

**Test 2 — SQL capture** (proves the constant is actually wired into the query):

The SQL template tag is called as `opts.sql\`...${value}...\`` — Bun/postgres tagged template. Mock by capturing `strings` (the raw template parts) and `values` (the interpolated values). Pattern from `issue-backfill.test.ts` (lines 78–99):

```ts
const sqlFn = mock(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.join("?");
  // inspect query and values...
  return [];
});
```

For the page-selection test:
- Create a `capturedCalls: Array<{ query: string; values: unknown[] }>` array
- Mock sql to push each call and return `[]`
- Call `createUpdateGenerator({ sql: mockSql, ... }).run({ topN: 5 })`
- When page-selection returns `[]`, `createUpdateGenerator` logs "No stale pages" and returns early — no further SQL calls needed
- Assert one captured call's `strings.join("")` contains `"heuristic_score >="` and the corresponding values array includes `3`

**Mock construction:** `UpdateGeneratorOptions` requires:
- `sql: Sql` — the capturing mock function
- `wikiPageStore: WikiPageStore` — not called if page-selection returns `[]`, so a minimal mock suffices
- `taskRouter: TaskRouter` — same, not called; `{ resolve: mock(() => ...) }`
- `logger: Logger` — `{ info: mock(()=>{}), warn: mock(()=>{}), error: mock(()=>{}), debug: mock(()=>{}), child: mock(()=>...) }`
- `githubOwner: "xbmc"`, `githubRepo: "xbmc"`

The full `wikiPageStore` mock shape is already available in `wiki-staleness-detector.test.ts` lines 88–122. Copy or simplify — since `processPage` won't be reached, `getPageChunks` only needs to be a mock stub.

**Import additions needed in test file:**
```ts
import { matchPatchesToSection, buildGroundedSectionPrompt, parseGeneratedSuggestion, checkGrounding, createUpdateGenerator, MIN_HEURISTIC_SCORE } from "./wiki-update-generator.ts";
import { mock } from "bun:test";
```

## Test Query Capture Constraint

When `${MIN_HEURISTIC_SCORE}` is interpolated in a tagged SQL template, it becomes a parameter value, not part of the query string. So `strings.join("?")` gives:
```
SELECT DISTINCT wpp.page_id, wpp.page_title, wpp.composite_score
          FROM wiki_page_popularity wpp
          INNER JOIN wiki_pr_evidence wpe ON wpe.matched_page_id = wpp.page_id
          WHERE wpe.heuristic_score >= ?
          ORDER BY wpp.composite_score DESC
          LIMIT ?
```

The test should assert:
- `capturedCall.query` contains `"heuristic_score >="` — proves the WHERE clause is present
- `capturedCall.values` includes `3` — proves the constant value is wired correctly

This two-part assertion is robust against any reformatting of the SQL literal.

## Verification

```bash
bun test src/knowledge/wiki-update-generator.test.ts
```

Must pass with:
- All 31 existing tests still green
- 2 new tests passing: `MIN_HEURISTIC_SCORE is set to 3` + SQL capture test

No DB, no LLM, no external deps required.

## What NOT to Change

- `MIN_OVERLAP_SCORE` — leave as-is, no export needed, untouched
- The evidence-fetch query in `processPage` (lines 491–498) — no score filter here
- The `pageIds`-branch query (lines 373–377) — no score filter here (explicit page IDs bypass selection entirely by design)
- Any existing tests — additive only
