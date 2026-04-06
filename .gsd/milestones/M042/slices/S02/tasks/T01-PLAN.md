---
estimated_steps: 2
estimated_files: 2
skills_used: []
---

# T01: Harden prompt author-tier wording regressions

Add focused prompt-builder regression coverage around the author-experience section so established and senior contributors cannot silently fall back to newcomer or developing guidance. If the current `buildAuthorExperienceSection()` copy is ambiguous under the new negative guards, tighten the wording in `src/execution/review-prompt.ts` without changing the S01 precedence contract.

Assumption: the existing mapping in `buildAuthorExperienceSection()` remains the correct taxonomy seam for S02 (`first-time/newcomer`, `regular/developing`, `established`, `core/senior`). Do not redesign the tier model here.

## Inputs

- ``src/execution/review-prompt.ts``
- ``src/execution/review-prompt.test.ts``
- ``.gsd/milestones/M042/slices/S02/S02-RESEARCH.md``

## Expected Output

- ``src/execution/review-prompt.ts``
- ``src/execution/review-prompt.test.ts``

## Verification

bun test ./src/execution/review-prompt.test.ts

## Observability Impact

Prompt truthfulness becomes directly inspectable through full-string regression tests that fail on banned newcomer/developing phrases instead of indirect proxy assertions.
