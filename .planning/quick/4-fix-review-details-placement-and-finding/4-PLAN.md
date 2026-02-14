---
phase: quick-4
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/handlers/review.ts
autonomous: true
must_haves:
  truths:
    - "Review Details collapsible block is nested inside the Kodiai Review Summary collapsible block"
    - "Finding counts in Review Details include both inline comment findings AND summary body observations"
    - "The review output marker comment stays outside both details blocks"
  artifacts:
    - path: "src/handlers/review.ts"
      provides: "Fixed appendReviewDetailsToSummary and finding count logic"
  key_links:
    - from: "appendReviewDetailsToSummary"
      to: "summary comment body"
      via: "inserts review details before closing </details> tag"
      pattern: "insertBefore.*</details>"
    - from: "findingCounts"
      to: "summary body severity tags"
      via: "parseSeverityTagsFromBody merges counts"
      pattern: "\\[CRITICAL\\]|\\[MAJOR\\]|\\[MEDIUM\\]|\\[MINOR\\]"
---

<objective>
Fix two bugs in the review output: (1) Review Details block renders outside the Kodiai Review Summary instead of nested inside it; (2) Finding counts only reflect inline review comments, missing observations from the summary body.

Purpose: Review output should be a single collapsible block with accurate finding counts.
Output: Fixed `src/handlers/review.ts` with both bugs resolved.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/handlers/review.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Nest Review Details inside Kodiai Review Summary</name>
  <files>src/handlers/review.ts</files>
  <action>
Fix `appendReviewDetailsToSummary()` (around line 332) so the Review Details block is inserted INSIDE the summary's `<details>` block, not appended after it.

Current broken logic (line 332):
```ts
const updatedBody = `${summaryComment.body}\n\n${reviewDetailsBlock}`;
```

The `summaryComment.body` structure is:
```
<details><summary>Kodiai Review Summary</summary>
...summary content...
</details>

<!-- kodiai:review-output-key:... -->
```

So appending puts Review Details AFTER `</details>` -- two separate collapsible sections.

**Fix approach:**

1. The `reviewDetailsBlock` returned by `formatReviewDetailsSummary()` currently includes its own `<!-- kodiai:review-details:... -->` marker at the end (line 253). The block structure is:
   ```
   <details>
   <summary>Review Details</summary>
   ...content...
   </details>

   <!-- kodiai:review-details:... -->
   ```

2. In `appendReviewDetailsToSummary`, find the LAST occurrence of `</details>` in `summaryComment.body` (this closes the Kodiai Review Summary block). Insert `reviewDetailsBlock` BEFORE that closing tag, with a blank line separator.

3. The review output marker (`<!-- kodiai:review-output-key:... -->`) that follows the summary's `</details>` must remain OUTSIDE -- do not move it.

4. Implementation: Split `summaryComment.body` at the last `</details>` boundary. Use `lastIndexOf('</details>')` to find the split point. Insert the review details block before it:
   ```ts
   const closingTag = '</details>';
   const lastCloseIdx = summaryComment.body.lastIndexOf(closingTag);
   if (lastCloseIdx === -1) {
     // Fallback: append as before if structure is unexpected
     updatedBody = `${summaryComment.body}\n\n${reviewDetailsBlock}`;
   } else {
     const before = summaryComment.body.slice(0, lastCloseIdx);
     const after = summaryComment.body.slice(lastCloseIdx);
     updatedBody = `${before}\n\n${reviewDetailsBlock}\n${after}`;
   }
   ```

5. Note: The `reviewDetailsBlock` itself contains `<details>` / `</details>` for its own collapsible, so nesting is fine -- GitHub renders nested `<details>` correctly.
  </action>
  <verify>
Read the modified function and manually trace the output structure to confirm:
- Summary body `<details>` opens
- Summary content appears
- Review Details `<details>` block appears (nested)
- Summary `</details>` closes
- Marker comment remains outside

Run: `npx tsc --noEmit` to confirm no type errors.
  </verify>
  <done>Review Details block is inserted before the summary's closing `</details>` tag, producing a single nested collapsible structure. The review output marker stays outside both blocks.</done>
</task>

<task type="auto">
  <name>Task 2: Include summary body observations in finding counts</name>
  <files>src/handlers/review.ts</files>
  <action>
Fix the finding counts (line 1983-1988) to include severity-tagged observations from the summary body, not just inline review comment findings.

The LLM writes `[CRITICAL]`, `[MAJOR]`, `[MEDIUM]`, `[MINOR]` tags in the summary body under `## Observations > ### Impact`. These are not captured by `extractFindingsFromReviewComments` (which only parses PR review comments).

**Approach:** Parse severity tags from the summary body text INSIDE `appendReviewDetailsToSummary`, since that function already has `summaryComment.body`. Then update the findings line in the `reviewDetailsBlock` string before inserting it.

1. Add a helper function `parseSeverityCountsFromBody(body: string)` near the other helper functions (around line 137):
   ```ts
   function parseSeverityCountsFromBody(body: string): {
     critical: number;
     major: number;
     medium: number;
     minor: number;
   } {
     // Match severity tags like [CRITICAL], [MAJOR], etc. in the summary body
     // These appear in observation bullets, e.g. "- [MAJOR] Some observation"
     // Use word boundaries to avoid matching inside code blocks or URLs
     const countMatches = (tag: string) => {
       const regex = new RegExp(`\\[${tag}\\]`, 'gi');
       return (body.match(regex) || []).length;
     };
     return {
       critical: countMatches('CRITICAL'),
       major: countMatches('MAJOR'),
       medium: countMatches('MEDIUM'),
       minor: countMatches('MINOR'),
     };
   }
   ```

2. In `appendReviewDetailsToSummary` (after fetching `summaryComment.body` and before inserting the review details block), parse the summary body for severity tags and update the findings line in `reviewDetailsBlock`:
   ```ts
   const bodyCounts = parseSeverityCountsFromBody(summaryComment.body);
   // Update the findings line in the review details block to include summary body observations
   // The line looks like: "- Findings: X critical, Y major, Z medium, W minor"
   if (bodyCounts.critical + bodyCounts.major + bodyCounts.medium + bodyCounts.minor > 0) {
     reviewDetailsBlock = reviewDetailsBlock.replace(
       /- Findings: (\d+) critical, (\d+) major, (\d+) medium, (\d+) minor/,
       (match, c, ma, me, mi) => {
         const total = {
           critical: parseInt(c) + bodyCounts.critical,
           major: parseInt(ma) + bodyCounts.major,
           medium: parseInt(me) + bodyCounts.medium,
           minor: parseInt(mi) + bodyCounts.minor,
         };
         return `- Findings: ${total.critical} critical, ${total.major} major, ${total.medium} medium, ${total.minor} minor (includes ${bodyCounts.critical + bodyCounts.major + bodyCounts.medium + bodyCounts.minor} from summary observations)`;
       }
     );
   }
   ```

3. The `reviewDetailsBlock` parameter in `appendReviewDetailsToSummary` is currently typed as `string`. Change the local binding to `let` so it can be reassigned after the regex replace. The function signature parameter stays `string`, just assign to a local `let`:
   ```ts
   let updatedReviewDetails = reviewDetailsBlock;
   // ... do the replace on updatedReviewDetails ...
   ```

4. Important: This update only applies to the `appendReviewDetailsToSummary` path (when summary comment exists). For the standalone `upsertReviewDetailsComment` fallback path (line 2047, 2060), the finding counts remain as-is from inline findings only (acceptable -- if summary wasn't posted, there are no summary body observations to count).
  </action>
  <verify>
Read the modified code and verify:
- `parseSeverityCountsFromBody` correctly counts `[SEVERITY]` tags
- The regex replace correctly parses and sums the counts
- The annotation "(includes N from summary observations)" only appears when body counts > 0
- The standalone path is not affected

Run: `npx tsc --noEmit` to confirm no type errors.
  </verify>
  <done>Finding counts in Review Details include observations from the summary body text, with a parenthetical note showing how many came from summary observations. Standalone review details (no summary comment) remain unchanged.</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. Manual trace of `appendReviewDetailsToSummary` output confirms nested structure
3. `parseSeverityCountsFromBody` correctly counts `[CRITICAL]`, `[MAJOR]`, `[MEDIUM]`, `[MINOR]` tags
4. Finding counts line shows merged totals with annotation when summary observations exist
</verification>

<success_criteria>
- Review Details `<details>` block renders inside the Kodiai Review Summary `<details>` block (nested collapsible)
- Review output marker (`<!-- kodiai:review-output-key:... -->`) remains outside both blocks
- Finding counts include both inline findings AND summary body severity-tagged observations
- TypeScript compiles without errors
</success_criteria>

<output>
After completion, create `.planning/quick/4-fix-review-details-placement-and-finding/4-SUMMARY.md`
</output>
