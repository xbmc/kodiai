---
estimated_steps: 5
estimated_files: 2
---

# T01: Fix `formatSummaryTable` Labels and Add Regression Tests

**Slice:** S04 — Final Integrated Publication & Retrofit Proof
**Milestone:** M028

## Description

`formatSummaryTable` in `src/knowledge/wiki-publisher.ts` still emits three stale suggestion-style labels:

1. Title line: `"# Wiki Update Suggestions — ${date}"` → must be `"# Wiki Modification Artifacts — ${date}"`
2. Stat line: `"**Suggestions posted:** ${totalSuggestions}"` → must be `"**Modifications posted:** ${totalSuggestions}"`
3. Voice Warnings column: table header includes `Voice Warnings` and every row emits `voiceCol` → must be removed entirely

Two tests in `wiki-publisher.test.ts` assert the old strings (lines ~215 and ~240) and must be updated. The "shows voice warning column" test must also be updated or removed since that column no longer renders. New negative guards must be added to prevent these labels from returning.

This is a pure code and test change — no DB migrations, no new files, no type changes.

## Steps

1. In `src/knowledge/wiki-publisher.ts`, edit `formatSummaryTable`:
   - Change `"# Wiki Update Suggestions — ${date}"` → `"# Wiki Modification Artifacts — ${date}"`
   - Change `"**Suggestions posted:** ${totalSuggestions}"` → `"**Modifications posted:** ${totalSuggestions}"`
   - Remove the Voice Warnings column from the table header: change `"| # | Page | Wiki Link | Sections | PRs Cited | Voice Warnings | Comment |"` → `"| # | Page | Wiki Link | Sections | PRs Cited | Comment |"` and the separator row accordingly
   - Remove `const voiceCol = r.hasVoiceWarnings ? "yes" : "no";` from the loop
   - Remove `${voiceCol}` from the row template string in the loop

2. In `src/knowledge/wiki-publisher.test.ts`, update the two stale positive assertions:
   - Line ~215: change `expect(result).toContain("# Wiki Update Suggestions — 2026-03-05")` → `expect(result).toContain("# Wiki Modification Artifacts — 2026-03-05")`
   - Line ~240: change `expect(result).toContain("**Suggestions posted:** 4")` → `expect(result).toContain("**Modifications posted:** 4")`

3. In `wiki-publisher.test.ts`, update or remove the "shows voice warning column" test that currently checks `expect(result).toContain("| yes |")` and `expect(result).toContain("| no |")` — these no longer render after removing the column.

4. In the `formatSummaryTable` describe block in `wiki-publisher.test.ts`, add negative guards:
   ```ts
   it("does not contain suggestion-style labels", () => {
     const result = formatSummaryTable("2026-03-05", [], 0);
     expect(result).not.toContain("Wiki Update Suggestions");
     expect(result).not.toContain("Suggestions posted");
     expect(result).not.toContain("Voice Warnings");
     expect(result).not.toContain("WHY:");
     expect(result).not.toContain(":warning:");
   });
   ```

5. Run the publisher test suite and confirm all tests pass.

## Must-Haves

- [ ] `formatSummaryTable` title line contains "Wiki Modification Artifacts", not "Wiki Update Suggestions"
- [ ] `formatSummaryTable` stat line contains "Modifications posted", not "Suggestions posted"
- [ ] Voice Warnings column removed from both table header and all data rows
- [ ] Two previously-stale test assertions updated to match new strings
- [ ] New negative guards added: `not.toContain("Wiki Update Suggestions")`, `not.toContain("Suggestions posted")`, `not.toContain("Voice Warnings")`
- [ ] `bun test src/knowledge/wiki-publisher.test.ts` passes with 0 failures

## Verification

```bash
bun test src/knowledge/wiki-publisher.test.ts
# → all pass, 0 fail

# Spot check — confirm old strings gone, new strings present:
bun -e "
  import { formatSummaryTable } from './src/knowledge/wiki-publisher.ts';
  const r = formatSummaryTable('2026-03-05', [], 0);
  console.log(r.includes('Wiki Update Suggestions') ? 'FAIL: old title' : 'OK: title');
  console.log(r.includes('Modifications posted') ? 'OK: stat' : 'FAIL: missing new stat');
  console.log(r.includes('Voice Warnings') ? 'FAIL: column still present' : 'OK: column removed');
"
```

## Inputs

- `src/knowledge/wiki-publisher.ts` — current `formatSummaryTable` at lines ~69–112; the `voiceCol` variable and Voice Warnings column are in the loop body
- `src/knowledge/wiki-publisher.test.ts` — current `formatSummaryTable` describe block starting at line ~210; stale assertions at lines ~215 and ~240; voice warning column test at line ~245

## Expected Output

- `src/knowledge/wiki-publisher.ts` — `formatSummaryTable` emits modification-only labels with no Voice Warnings column
- `src/knowledge/wiki-publisher.test.ts` — updated assertions + new negative guards; suite passes with 0 failures
