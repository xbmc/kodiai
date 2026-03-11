# Requirements

## Active

### R001 — TypeScript strict compilation passes
- Class: quality-attribute
- Status: active
- Description: `bunx tsc --noEmit` produces zero errors across the entire codebase
- Why it matters: 474 TS errors undermine refactoring confidence and IDE support; strict types prevent runtime nullability bugs
- Source: execution
- Primary owning slice: M026/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Errors concentrated in triage/, telemetry/store.test.ts, knowledge/store.ts, handlers/

### R002 — Dead code and legacy artifacts removed
- Class: quality-attribute
- Status: validated
- Description: Deprecated files (db-path.ts, SQLite databases in data/, root-level test-delta-verification.ts), stale SQLite references in comments, and orphaned code are removed
- Why it matters: Dead code confuses contributors and agents; stale references mislead about the actual storage backend
- Source: execution
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: S01 — all deprecated files deleted, SQLite refs in telemetry/types.ts at 0, also removed kodiai-stats.ts and kodiai-trends.ts
- Notes: 5 files deleted total; .gitignore now covers data/

### R003 — .env.example documents all env vars
- Class: operability
- Status: validated
- Description: .env.example lists every environment variable the app reads with required/optional status and description
- Why it matters: Current .env.example has 7 vars; production uses 22+. New contributors cannot set up the project
- Source: execution
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: S01 — 26 vars documented in 9 categories with required/optional markers
- Notes: GITHUB_PRIVATE_KEY and GITHUB_PRIVATE_KEY_BASE64 listed as separate alternative entries

### R004 — .gitignore covers all generated artifacts
- Class: quality-attribute
- Status: validated
- Description: data/, .planning/ (after archive), and any other generated directories are properly gitignored
- Why it matters: SQLite files in data/ could get committed; .planning/ is 11MB of legacy planning tracked in git
- Source: execution
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: S01 — data/ and .planning/ entries verified in .gitignore
- Notes: Both entries present with descriptive comments

### R005 — Stale git branches cleaned up
- Class: quality-attribute
- Status: validated
- Description: Merged local branches are deleted; only main and active feature branches remain
- Why it matters: 36 local branches, 5+ already merged into main — confusing for anyone running `git branch`
- Source: execution
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: S01 — 7 merged local branches + 1 remote branch deleted; git branch --merged main returns 0 non-main/gsd branches
- Notes: Also removed 2 stale worktrees and pruned 28 stale remote tracking refs

### R006 — console.log replaced with structured pino logger
- Class: quality-attribute
- Status: active
- Description: Production source files use pino logger instead of console.log/warn/error (scripts/migrations excluded)
- Why it matters: console.log bypasses structured logging, making production debugging harder
- Source: execution
- Primary owning slice: M026/S02
- Supporting slices: none
- Validation: unmapped
- Notes: 12 source files currently use console.log/warn/error in non-test code

### R007 — Comprehensive README with contributor onboarding
- Class: quality-attribute
- Status: active
- Description: README covers architecture overview, complete setup instructions, configuration reference, and links to in-depth docs
- Why it matters: Current README lists features but is light on architecture, contributor guidance, and complete config reference
- Source: user
- Primary owning slice: M026/S05
- Supporting slices: M026/S03, M026/S04
- Validation: unmapped
- Notes: Target audience is open-source contributors

### R008 — Architecture documentation
- Class: quality-attribute
- Status: active
- Description: docs/architecture.md explains the system design, module boundaries, data flow, and key abstractions
- Why it matters: 212 source files across 20+ directories with no architectural documentation; contributors must read code to understand structure
- Source: user
- Primary owning slice: M026/S03
- Supporting slices: none
- Validation: unmapped
- Notes: Should cover handler flow, knowledge pipeline, execution model, LLM routing

### R009 — Configuration reference documentation
- Class: quality-attribute
- Status: active
- Description: docs/configuration.md documents every .kodiai.yml option with types, defaults, and examples
- Why it matters: Users have no reference for config options; only way to learn is reading config.ts (911 lines)
- Source: user
- Primary owning slice: M026/S03
- Supporting slices: none
- Validation: unmapped
- Notes: Should be generated or hand-written from config.ts schema

### R010 — Knowledge system documentation
- Class: quality-attribute
- Status: active
- Description: docs/knowledge-system.md documents the 5-corpus retrieval pipeline, embedding strategy, hybrid search, and RRF merging
- Why it matters: The knowledge system is the crown jewel — 63 files in src/knowledge/ with zero external docs
- Source: user
- Primary owning slice: M026/S04
- Supporting slices: none
- Validation: unmapped
- Notes: Should cover each corpus, chunking strategy, search flow, citation format

### R011 — Deployment and operations documentation
- Class: operability
- Status: active
- Description: docs/deployment.md consolidates deployment instructions; existing runbooks are linked from a docs index
- Why it matters: deployment.md is orphaned at project root; runbooks exist but aren't discoverable from README
- Source: user
- Primary owning slice: M026/S03
- Supporting slices: none
- Validation: unmapped
- Notes: Move deployment.md into docs/, create docs/README.md as index

### R012 — Contributing guide
- Class: quality-attribute
- Status: active
- Description: CONTRIBUTING.md covers development setup, testing, code style, PR process, and module ownership
- Why it matters: Open-source contributor audience needs onboarding guide
- Source: user
- Primary owning slice: M026/S05
- Supporting slices: none
- Validation: unmapped
- Notes: Should reference architecture docs and testing conventions

### R013 — CHANGELOG updated through v0.25
- Class: quality-attribute
- Status: active
- Description: CHANGELOG.md backfilled with entries for v0.17 through v0.25
- Why it matters: Current CHANGELOG stops at v0.16; 9 milestones of work are undocumented in the changelog
- Source: user
- Primary owning slice: M026/S05
- Supporting slices: none
- Validation: unmapped
- Notes: Source from .gsd/PROJECT.md release history and milestone summaries

### R014 — God file light extraction
- Class: quality-attribute
- Status: active
- Description: Extract obvious helper functions from review.ts (4,415 lines) and mention.ts (2,677 lines) without restructuring handler flow
- Why it matters: These files are too large for effective code review and agent comprehension
- Source: user
- Primary owning slice: M026/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Light extraction only — no restructuring. Focus on pure functions that can be moved to lib/

### R015 — Test suite passes cleanly
- Class: quality-attribute
- Status: active
- Description: All tests pass or DB-dependent tests are properly skipped when Postgres is unavailable
- Why it matters: 4 failing tests (pgvector stores + telemetry purge) fail on every local run without Postgres
- Source: execution
- Primary owning slice: M026/S02
- Supporting slices: none
- Validation: unmapped
- Notes: Tests should skip gracefully when DATABASE_URL is not set

### R016 — Legacy .planning/ archived and removed from tracking
- Class: quality-attribute
- Status: validated
- Description: .planning/ directory (11MB, 1028 files) removed from git tracking and added to .gitignore
- Why it matters: Superseded by .gsd/; adds bulk to clone and confuses the two planning systems
- Source: user
- Primary owning slice: M026/S01
- Supporting slices: none
- Validation: S01 — git ls-files .planning/ returns 0; README .planning/ references replaced with CHANGELOG.md
- Notes: Local .planning/ directory preserved on disk; .gitignore prevents re-tracking

## Validated

### R002 — Dead code and legacy artifacts removed
- Validated by: M026/S01
- Proof: All 5 deprecated files deleted; grep -c 'SQLite' src/telemetry/types.ts returns 0

### R003 — .env.example documents all env vars
- Validated by: M026/S01
- Proof: grep -c '^[A-Z_]*=' .env.example returns 26 (≥24)

### R004 — .gitignore covers all generated artifacts
- Validated by: M026/S01
- Proof: data/ and .planning/ entries verified in .gitignore

### R005 — Stale git branches cleaned up
- Validated by: M026/S01
- Proof: git branch --merged main returns 0 non-main/gsd branches

### R016 — Legacy .planning/ archived and removed from tracking
- Validated by: M026/S01
- Proof: git ls-files .planning/ returns 0; README has no .planning/ links

## Deferred

### R017 — Full handler refactoring
- Class: quality-attribute
- Status: deferred
- Description: Deep restructuring of review.ts and mention.ts into smaller, composable handler modules
- Why it matters: Would improve maintainability significantly
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred — high-risk refactor that warrants its own milestone with comprehensive testing

### R018 — Automated dead code detection
- Class: quality-attribute
- Status: deferred
- Description: Tooling to detect unused exports, unreachable code, and orphaned modules
- Why it matters: Manual audit found some; automated tooling would catch ongoing drift
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Deferred — investigate ts-prune or knip in a future milestone

## Out of Scope

### R019 — Phase verification script cleanup
- Class: quality-attribute
- Status: out-of-scope
- Description: The phase-numbered verification scripts (phase72-*, phase80-*, etc.) in scripts/ have confusing names but are actively used
- Why it matters: Renaming would break package.json aliases and existing CI workflows
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: These are referenced by name in package.json scripts and operator runbooks; renaming is a separate concern

### R020 — API endpoint documentation
- Class: quality-attribute
- Status: out-of-scope
- Description: Formal OpenAPI/Swagger docs for webhook endpoints
- Why it matters: Kodiai's endpoints are webhook receivers, not user-facing APIs — formal API docs would be over-engineering
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: The 4 endpoints are documented in README and architecture docs

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | quality-attribute | active | M026/S02 | none | unmapped |
| R002 | quality-attribute | validated | M026/S01 | none | S01 — deprecated files deleted, SQLite refs fixed |
| R003 | operability | validated | M026/S01 | none | S01 — 26 vars documented |
| R004 | quality-attribute | validated | M026/S01 | none | S01 — data/ and .planning/ in .gitignore |
| R005 | quality-attribute | validated | M026/S01 | none | S01 — all merged branches deleted |
| R006 | quality-attribute | active | M026/S02 | none | unmapped |
| R007 | quality-attribute | active | M026/S05 | M026/S03, M026/S04 | unmapped |
| R008 | quality-attribute | active | M026/S03 | none | unmapped |
| R009 | quality-attribute | active | M026/S03 | none | unmapped |
| R010 | quality-attribute | active | M026/S04 | none | unmapped |
| R011 | operability | active | M026/S03 | none | unmapped |
| R012 | quality-attribute | active | M026/S05 | none | unmapped |
| R013 | quality-attribute | active | M026/S05 | none | unmapped |
| R014 | quality-attribute | active | M026/S02 | none | unmapped |
| R015 | quality-attribute | active | M026/S02 | none | unmapped |
| R016 | quality-attribute | validated | M026/S01 | none | S01 — .planning/ untracked, README updated |
| R017 | quality-attribute | deferred | none | none | unmapped |
| R018 | quality-attribute | deferred | none | none | unmapped |
| R019 | quality-attribute | out-of-scope | none | none | n/a |
| R020 | quality-attribute | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 11
- Mapped to slices: 11
- Validated: 5 (R002, R003, R004, R005, R016)
- Unmapped active requirements: 0
