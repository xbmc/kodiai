# T01: 57-analysis-layer 01

**Slice:** S02 — **Milestone:** M010

## Description

Create the usage analyzer and scope coordinator pure-function modules.

Purpose: These modules implement the core analysis logic for DEP-04 (workspace usage evidence) and DEP-06 (multi-package coordination). They are pure functions with no side effects, testable in isolation, wired into the review handler in a later plan.

Output: Two new modules with tests in src/lib/

## Must-Haves

- [ ] "analyzePackageUsage returns file:line evidence for imports of a given package"
- [ ] "analyzePackageUsage respects a time budget and returns timedOut=true on timeout"
- [ ] "analyzePackageUsage fails open (returns empty evidence on error, never throws)"
- [ ] "detectScopeCoordination groups scoped packages sharing a prefix when 2+ present"
- [ ] "detectScopeCoordination returns empty array for single-package or non-scoped packages"

## Files

- `src/lib/usage-analyzer.ts`
- `src/lib/usage-analyzer.test.ts`
- `src/lib/scope-coordinator.ts`
- `src/lib/scope-coordinator.test.ts`
