---
estimated_steps: 5
estimated_files: 2
skills_used:
  - test
---

# T01: Add heuristic score threshold constant, SQL clause, and tests

**Slice:** S02 — Heuristic Score Threshold in Page Selection
**Milestone:** M029

## Description

`createUpdateGenerator` currently selects pages by joining `wiki_page_popularity` with `wiki_pr_evidence` but applies no quality floor on the PR evidence. This means pages matched by superficial token overlap (score < 3 — "Low" or "Medium" relevance in the staleness detector's taxonomy) can be selected for generation, producing and publishing irrelevant content.

The fix is one SQL clause and one exported constant. The tests prove the constant value is correct and that the constant is actually wired into the query (not just defined but unused).

## Steps

1. Open `src/knowledge/wiki-update-generator.ts`. Find line 38: `const MIN_OVERLAP_SCORE = 2;`. Immediately after it, add:
   ```ts
   /** Minimum heuristic score for PR evidence to qualify a page for selection. */
   export const MIN_HEURISTIC_SCORE = 3;
   ```

2. Find the page-selection `else` branch SQL query (currently around line 380). It reads:
   ```sql
   SELECT DISTINCT wpp.page_id, wpp.page_title, wpp.composite_score
   FROM wiki_page_popularity wpp
   INNER JOIN wiki_pr_evidence wpe ON wpe.matched_page_id = wpp.page_id
   ORDER BY wpp.composite_score DESC
   LIMIT ${topN}
   ```
   Add `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` before `ORDER BY`:
   ```sql
   SELECT DISTINCT wpp.page_id, wpp.page_title, wpp.composite_score
   FROM wiki_page_popularity wpp
   INNER JOIN wiki_pr_evidence wpe ON wpe.matched_page_id = wpp.page_id
   WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}
   ORDER BY wpp.composite_score DESC
   LIMIT ${topN}
   ```
   Do NOT touch the `pageIds` branch query (which bypasses selection entirely) or the evidence-fetch query in `processPage` (which fetches all evidence for an already-selected page).

3. Open `src/knowledge/wiki-update-generator.test.ts`. Add `createUpdateGenerator` and `MIN_HEURISTIC_SCORE` to the existing import from `./wiki-update-generator.ts`. Also add `mock` to the import from `bun:test`.

4. At the end of the test file, add a new `describe` block with two tests:

   **Test 1 — constant value** (deterministic, no mock needed):
   ```ts
   describe("MIN_HEURISTIC_SCORE", () => {
     it("is set to 3 (High relevance threshold)", () => {
       expect(MIN_HEURISTIC_SCORE).toBe(3);
     });
   });
   ```

   **Test 2 — SQL capture** (proves constant is wired into the query):
   ```ts
   describe("createUpdateGenerator page selection", () => {
     it("includes heuristic_score >= MIN_HEURISTIC_SCORE in the page-selection query", async () => {
       const capturedCalls: Array<{ query: string; values: unknown[] }> = [];

       const sqlMock = mock(async (strings: TemplateStringsArray, ...values: unknown[]) => {
         capturedCalls.push({ query: strings.join("?"), values });
         return [];
       });

       const logMock = { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}), debug: mock(() => {}), child: mock(() => logMock) };

       const generator = createUpdateGenerator({
         sql: sqlMock as unknown as import("postgres").Sql,
         wikiPageStore: {
           getPageChunks: mock(async () => []),
           upsertWikiPage: mock(async () => {}),
           upsertWikiPageComment: mock(async () => ({ commentId: 0, created: false })),
         } as unknown as import("./wiki-types.ts").WikiPageStore,
         taskRouter: { resolve: mock(() => Promise.resolve("")) } as unknown as import("../tasks/task-router.ts").TaskRouter,
         logger: logMock as unknown as import("../logger.ts").Logger,
         githubOwner: "xbmc",
         githubRepo: "wiki",
       });

       await generator.run({ topN: 5 });

       // Page-selection returns [] so generator exits early; one SQL call captured
       expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
       const pageSelectCall = capturedCalls[0];
       expect(pageSelectCall.query).toContain("heuristic_score >=");
       expect(pageSelectCall.values).toContain(3);
     });
   });
   ```

   If the exact import paths for `Sql`, `WikiPageStore`, `TaskRouter`, or `Logger` differ from what is shown above, adjust to match the actual import paths used elsewhere in the test file. The mock shapes do not need to be complete — only the fields exercised when `run({ topN: 5 })` is called with an empty page-selection result matter.

5. Run `bun test src/knowledge/wiki-update-generator.test.ts` and confirm all tests pass (existing + 2 new).

## Must-Haves

- [ ] `export const MIN_HEURISTIC_SCORE = 3;` present in `wiki-update-generator.ts`
- [ ] `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}` present in the page-selection query (not the `pageIds` branch, not the evidence-fetch query)
- [ ] `MIN_HEURISTIC_SCORE` test: `expect(MIN_HEURISTIC_SCORE).toBe(3)` passes
- [ ] SQL-capture test: asserts `query` contains `"heuristic_score >="` and `values` includes `3`
- [ ] All previously passing tests still pass (no regressions)

## Verification

- `bun test src/knowledge/wiki-update-generator.test.ts` exits 0 with all tests passing

## Inputs

- `src/knowledge/wiki-update-generator.ts` — source file to add constant and SQL clause
- `src/knowledge/wiki-update-generator.test.ts` — test file to extend with new imports and tests

## Expected Output

- `src/knowledge/wiki-update-generator.ts` — modified: exports `MIN_HEURISTIC_SCORE = 3`; page-selection query includes `WHERE wpe.heuristic_score >= ${MIN_HEURISTIC_SCORE}`
- `src/knowledge/wiki-update-generator.test.ts` — modified: imports `createUpdateGenerator`, `MIN_HEURISTIC_SCORE`, `mock`; adds two new test blocks
