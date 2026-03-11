# S10: Language Aware Enforcement

**Goal:** Create the foundation types, tooling detection module, and config schema extension for the language-aware enforcement system.
**Demo:** Create the foundation types, tooling detection module, and config schema extension for the language-aware enforcement system.

## Must-Haves


## Tasks

- [x] **T01: 39-language-aware-enforcement 01** `est:3min`
  - Create the foundation types, tooling detection module, and config schema extension for the language-aware enforcement system.

Purpose: Establish the type contracts and detection infrastructure that severity floor enforcement (Plan 02) and tooling suppression (Plan 03) build upon. The config schema extension enables user overrides via `.kodiai.yml`.

Output: `src/enforcement/types.ts`, `src/enforcement/tooling-detection.ts` with tests, updated `src/execution/config.ts` with `languageRules` schema section.
- [x] **T02: 39-language-aware-enforcement 02** `est:2min`
  - Implement severity floor enforcement with a built-in pattern catalog seeded from requirements and kodiai PR history analysis.

Purpose: Guarantee that safety-critical findings (C++ null deref, Go unchecked errors, Python bare excepts, etc.) appear at appropriate severity regardless of LLM judgment. Context-aware enforcement relaxes floors in test files per user decision.

Output: `src/enforcement/severity-floors.ts` with `enforceSeverityFloors()` pure function and `BUILTIN_SEVERITY_PATTERNS` catalog, fully tested via TDD.
- [x] **T03: 39-language-aware-enforcement 03** `est:2min`
  - Implement tooling-aware finding suppression that eliminates auto-fixable noise when repos have formatter/linter configs.

Purpose: When a repo has `.prettierrc`, `.clang-format`, `.eslintrc`, etc., the bot should produce zero findings about formatting style or import ordering in those languages -- the tooling handles it. This eliminates the most common source of low-value review noise.

Output: `src/enforcement/tooling-suppression.ts` with `suppressToolingFindings()` pure function, fully tested via TDD.
- [x] **T04: 39-language-aware-enforcement 04** `est:8min`
  - Wire the enforcement module into the review pipeline and create the barrel export, completing the language-aware enforcement feature.

Purpose: Connect all enforcement components (tooling detection, tooling suppression, severity floors) into the live review handler so that published reviews actually enforce language-specific rules. This is the final integration that makes the phase success criteria observable.

Output: `src/enforcement/index.ts` barrel export, updated `src/handlers/review.ts` with enforcement pipeline integration.

## Files Likely Touched

- `src/enforcement/types.ts`
- `src/enforcement/tooling-detection.ts`
- `src/enforcement/tooling-detection.test.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/enforcement/severity-floors.ts`
- `src/enforcement/severity-floors.test.ts`
- `src/enforcement/tooling-suppression.ts`
- `src/enforcement/tooling-suppression.test.ts`
- `src/enforcement/index.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
