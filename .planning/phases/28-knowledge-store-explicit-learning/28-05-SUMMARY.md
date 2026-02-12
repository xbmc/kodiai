---
phase: 28-knowledge-store-explicit-learning
plan: 05
subsystem: infra
tags: [knowledge-store, sqlite, cli, runtime, path-resolution]
requires:
  - phase: 28-knowledge-store-explicit-learning
    provides: knowledge-store runtime writes and reporting CLI scripts
provides:
  - canonical knowledge DB path resolver shared by runtime and reporting CLIs
  - env-first and explicit-arg DB resolution across stats/trends scripts
  - missing-path operator guidance for stats CLI with actionable commands
affects: [operations, diagnostics, reporting-cli]
tech-stack:
  added: []
  patterns: [shared path resolution contract, env-first CLI lookup, path-source diagnostics]
key-files:
  created: [src/knowledge/db-path.ts, src/knowledge/db-path.test.ts]
  modified: [src/index.ts, scripts/kodiai-stats.ts, scripts/kodiai-trends.ts]
key-decisions:
  - "Centralized knowledge DB selection in resolveKnowledgeDbPath with arg > env > default precedence"
  - "Made stats missing-path failures self-remediating with explicit KNOWLEDGE_DB_PATH and --db examples"
patterns-established:
  - "Runtime and CLI resolve the same DB path contract before touching SQLite"
  - "Resolver returns both absolute path and source tags for diagnostics"
duration: 2 min
completed: 2026-02-12
---

# Phase 28 Plan 05: Knowledge DB Path Contract Summary

**Runtime startup and operator reporting scripts now share one canonical `KNOWLEDGE_DB_PATH` contract, eliminating cwd drift and adding direct recovery guidance when stats cannot find the database.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-12T07:53:54Z
- **Completed:** 2026-02-12T07:55:56Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Added `src/knowledge/db-path.ts` as the canonical resolver with precedence `--db` -> `KNOWLEDGE_DB_PATH` -> default, returning absolute path plus source tags
- Wired `src/index.ts`, `scripts/kodiai-stats.ts`, and `scripts/kodiai-trends.ts` to consume the same resolver semantics
- Improved `kodiai-stats` missing DB output to include selected source and copy-paste remediation examples
- Added drift-focused regression coverage in `src/knowledge/db-path.test.ts` for env-first and explicit override precedence

## Task Commits

Each task was committed atomically:

1. **Task 1: Introduce canonical knowledge DB path contract and runtime wiring** - `ccf18815ce` (feat)
2. **Task 2: Add explicit missing-path guidance in kodiai-stats** - `a27e8a4381` (feat)
3. **Task 3: Add regression tests for runtime/CLI path drift** - `af0d25faf6` (test)

## Files Created/Modified
- `src/knowledge/db-path.ts` - canonical resolver and source tags
- `src/index.ts` - runtime path resolution via shared resolver
- `scripts/kodiai-stats.ts` - env-first contract usage and actionable missing-path guidance
- `scripts/kodiai-trends.ts` - env-first contract usage aligned with resolver
- `src/knowledge/db-path.test.ts` - precedence and cwd drift regression tests

## Decisions Made
- Standardized all knowledge DB path lookup behind one shared resolver to prevent runtime/CLI default drift
- Exposed source-aware diagnostics (`arg`, `env`, `default`) so operators can see why a path was selected

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `bunx tsc --noEmit ...` fails in this repository due pre-existing TypeScript/toolchain baseline errors outside this plan scope (module resolution, target, and dependency typing), while plan-specific runtime behavior and regression tests passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Knowledge writer and reporting readers now share deterministic DB path selection behavior
- Operators have explicit remediation steps when stats is pointed at a missing DB file

## Self-Check: PASSED
- Verified summary file exists on disk
- Verified all task commit hashes exist in git history

---
*Phase: 28-knowledge-store-explicit-learning*
*Completed: 2026-02-12*
