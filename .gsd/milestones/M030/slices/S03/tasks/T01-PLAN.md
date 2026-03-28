---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T01: Create addon-check-formatter module and unit tests

Build `src/lib/addon-check-formatter.ts` as a pure module with two exports: `buildAddonCheckMarker(owner, repo, prNumber)` returns the HTML marker string `<!-- kodiai:addon-check:{owner}/{repo}:{prNumber} -->`. `formatAddonCheckComment(findings, marker)` renders the full PR comment body: marker on line 1, then `## Kodiai Addon Check` heading, then a markdown table of ERROR and WARN findings (INFO filtered out), then a summary line `_X error(s), Y warning(s) found._`. If no ERROR/WARN findings, emit a clean pass: `## Kodiai Addon Check\n\n✅ No issues found by kodi-addon-checker.`\n\nTable format:\n```\n| Addon | Level | Message |\n|-------|-------|---------|\n| plugin.video.foo | ERROR | missing changelog |\n```\n\nWrite `src/lib/addon-check-formatter.test.ts` with tests covering: marker format, non-empty findings table with ERROR+WARN (INFO excluded), clean pass when findings empty or all-INFO, summary line counts only ERROR+WARN, marker appears first in the output. Import `AddonFinding` from `../handlers/addon-check.ts` (re-exported there) to avoid circular deps.

## Inputs

- `src/handlers/addon-check.ts`
- `src/lib/addon-checker-runner.ts`
- `src/triage/triage-comment.ts`

## Expected Output

- `src/lib/addon-check-formatter.ts`
- `src/lib/addon-check-formatter.test.ts`

## Verification

bun test src/lib/addon-check-formatter.test.ts
