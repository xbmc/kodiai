# T02: 39-language-aware-enforcement 02

**Slice:** S10 — **Milestone:** M007

## Description

Implement severity floor enforcement with a built-in pattern catalog seeded from requirements and kodiai PR history analysis.

Purpose: Guarantee that safety-critical findings (C++ null deref, Go unchecked errors, Python bare excepts, etc.) appear at appropriate severity regardless of LLM judgment. Context-aware enforcement relaxes floors in test files per user decision.

Output: `src/enforcement/severity-floors.ts` with `enforceSeverityFloors()` pure function and `BUILTIN_SEVERITY_PATTERNS` catalog, fully tested via TDD.

## Must-Haves

- [ ] "C++ null dereference findings are elevated to CRITICAL in production files"
- [ ] "C++ uninitialized member findings are elevated to CRITICAL in production files"
- [ ] "Go unchecked error findings are elevated to MAJOR in production files"
- [ ] "Python bare except findings are elevated to MAJOR in production files"
- [ ] "Severity floors are relaxed in test files per context-aware enforcement decision"
- [ ] "Findings already at or above the floor severity are not modified"
- [ ] "User-defined severity floor patterns from .kodiai.yml are applied"
- [ ] "disableBuiltinFloors=true uses only user-defined patterns"
- [ ] "Pattern matching uses keyword-set approach (OR of AND groups) for robustness against LLM output variation"

## Files

- `src/enforcement/severity-floors.ts`
- `src/enforcement/severity-floors.test.ts`
