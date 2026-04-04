---
estimated_steps: 18
estimated_files: 1
skills_used: []
---

# T02: Add xbmc fixture regression test and confirm plain-prose detection

Add a minimal real-world xbmc-style PR body fixture test to `src/lib/pr-intent-parser.test.ts` that proves the section-stripping fix works end-to-end, and confirm the plain-prose breaking-change detection path still fires.

Steps:
1. Construct a minimal xbmc PR body fixture — the actual xbmc template structure that caused the false positive:
```
## Description
Fix some bug in the player.

## Types of change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] Breaking change (fix or feature that will cause existing functionality to change)
- [ ] New feature (non-breaking change which adds functionality)

## Checklist
- [x] My code follows the code style of this project.
- [x] I have read the CONTRIBUTING document.
```
2. Add a test `'xbmc PR template body does not trigger breaking change in body'` that calls `parsePRIntent('Fix player bug', XBMC_FIXTURE_BODY)` and asserts `breakingChangeDetected === false` and `breakingChangeSources.filter(s => s.source === 'body')` is empty.
3. Add (or verify the existing) test `'plain body prose still triggers breaking change detection'` that calls `parsePRIntent('Update API', 'This is a breaking change to the REST API')` and asserts `breakingChangeDetected === true`.
4. Run `bun test ./src/lib/pr-intent-parser.test.ts` and confirm all pass.
5. Run `bun run tsc --noEmit` to confirm the type gate is clean.

## Inputs

- ``src/lib/pr-intent-parser.ts``
- ``src/lib/pr-intent-parser.test.ts``

## Expected Output

- ``src/lib/pr-intent-parser.test.ts``

## Verification

bun test ./src/lib/pr-intent-parser.test.ts
