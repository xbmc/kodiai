# T03: 39-language-aware-enforcement 03

**Slice:** S10 — **Milestone:** M007

## Description

Implement tooling-aware finding suppression that eliminates auto-fixable noise when repos have formatter/linter configs.

Purpose: When a repo has `.prettierrc`, `.clang-format`, `.eslintrc`, etc., the bot should produce zero findings about formatting style or import ordering in those languages -- the tooling handles it. This eliminates the most common source of low-value review noise.

Output: `src/enforcement/tooling-suppression.ts` with `suppressToolingFindings()` pure function, fully tested via TDD.

## Must-Haves

- [ ] "When a formatter config exists for a language, formatting/style findings in that language are suppressed"
- [ ] "When a linter config exists for a language, import-ordering findings in that language are suppressed"
- [ ] "Only formatting and import-order findings are suppressed -- correctness findings are never suppressed by tooling detection"
- [ ] "User toolingOverrides from .kodiai.yml can disable suppression per language or per type"
- [ ] "Unknown languages pass through without errors"
- [ ] "Suppressed findings are marked with toolingSuppressed=true"

## Files

- `src/enforcement/tooling-suppression.ts`
- `src/enforcement/tooling-suppression.test.ts`
