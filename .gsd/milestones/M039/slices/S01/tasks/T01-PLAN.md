---
estimated_steps: 36
estimated_files: 1
skills_used: []
---

# T01: Extend template-section stripping to remove heading body content

The current `stripTemplateBoilerplate` in `src/lib/pr-intent-parser.ts` removes heading lines for `## Types of change` and `## Checklist` but leaves the checkbox lines below them in place. The 3+-consecutive-checkbox-run backstop strips those runs, but it fails when the template has fewer than 3 boxes in a row or when runs are interrupted by blank lines.

The fix: replace the heading-only removal with a section-body removal that strips everything from the matched heading through (but not including) the next heading of the same or higher level.

Steps:
1. Read `src/lib/pr-intent-parser.ts` lines 72-90 carefully before editing.
2. Replace the heading-only regexes with a section-body removal approach. A safe pattern:
```ts
// Remove entire template heading sections (heading + all content until next same-or-higher-level heading)
// Targets: ## Types of change, ## Checklist, and similar boilerplate section names
const TEMPLATE_SECTION_HEADINGS = /^(#+)\s*(Types of change|Checklist|Checks|PR type|Change type)\b[^\n]*/im;
function stripTemplateSections(text: string): string {
  let out = text;
  let match: RegExpExecArray | null;
  const re = /^(#+)\s*(Types of change|Checklist|Checks|PR type|Change type)\b[^\n]*/gim;
  // Collect section ranges in reverse order so index math stays valid after replacement
  const ranges: Array<{ start: number; end: number }> = [];
  while ((match = re.exec(out)) !== null) {
    const hashes = match[1]!;
    const level = hashes.length;
    const start = match.index;
    // Find the next heading of equal or greater level (same or fewer # characters)
    const nextHeading = new RegExp(`^#{1,${level}}\\s+\\S`, 'gm');
    nextHeading.lastIndex = start + match[0].length;
    const next = nextHeading.exec(out);
    const end = next ? next.index : out.length;
    ranges.push({ start, end });
  }
  // Replace in reverse order to preserve indices
  for (const r of ranges.reverse()) {
    out = out.slice(0, r.start) + ' TEMPLATE_REMOVED ' + out.slice(r.end);
  }
  return out;
}
```
3. Update `stripTemplateBoilerplate` to call `stripTemplateSections` instead of the heading-line-only regexes. Keep the 3+-checkbox-run backstop as a secondary guard.
4. Verify the existing unit tests still pass (they use the function name `stripTemplateBoilerplate` via `parsePRIntent`; the internals can be refactored freely).
5. Run `bun run tsc --noEmit` and fix any type errors.

## Inputs

- ``src/lib/pr-intent-parser.ts``
- ``src/lib/pr-intent-parser.test.ts``

## Expected Output

- ``src/lib/pr-intent-parser.ts``

## Verification

bun test ./src/lib/pr-intent-parser.test.ts && bun run tsc --noEmit
