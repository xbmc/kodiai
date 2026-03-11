# T01: 39-language-aware-enforcement 01

**Slice:** S10 — **Milestone:** M007

## Description

Create the foundation types, tooling detection module, and config schema extension for the language-aware enforcement system.

Purpose: Establish the type contracts and detection infrastructure that severity floor enforcement (Plan 02) and tooling suppression (Plan 03) build upon. The config schema extension enables user overrides via `.kodiai.yml`.

Output: `src/enforcement/types.ts`, `src/enforcement/tooling-detection.ts` with tests, updated `src/execution/config.ts` with `languageRules` schema section.

## Must-Haves

- [ ] "Enforcement types define SeverityPattern, DetectedTooling, and EnforcedFinding structures"
- [ ] "detectRepoTooling scans workspace for formatter/linter config files and returns per-language results"
- [ ] "Go formatting is treated as always-on when go.mod exists (gofmt built-in)"
- [ ] "languageRules section in .kodiai.yml validates with Zod and falls back to defaults on error"
- [ ] "Tooling detection is fail-open -- filesystem errors never block the review"

## Files

- `src/enforcement/types.ts`
- `src/enforcement/tooling-detection.ts`
- `src/enforcement/tooling-detection.test.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
