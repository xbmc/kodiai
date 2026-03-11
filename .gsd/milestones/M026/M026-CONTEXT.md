# M026: Codebase Audit & Documentation — Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

## Project Description

Kodiai is a ~50K-line TypeScript GitHub App providing AI-powered PR reviews, conversational assistance, issue intelligence, and Slack integration. After 25 milestones of feature development, the codebase has accumulated technical debt: 474 TypeScript errors, dead legacy files, incomplete documentation, and stale artifacts. This milestone addresses all of it without changing runtime behavior.

## Why This Milestone

The codebase is functionally complete through v0.25 but has accumulated debt that makes it harder for new contributors and agents to navigate:
- Type errors erode confidence in refactoring
- Dead files and stale references mislead about architecture
- Documentation covers ops runbooks but has zero conceptual docs
- README is feature-complete but contributor-hostile
- .env.example is missing 15+ env vars

## User-Visible Outcome

### When this milestone is complete, the user can:

- Clone the repo and set up a working dev environment following docs alone
- Understand the architecture, configuration, and knowledge system from documentation without reading source
- Run `bunx tsc --noEmit` with zero errors
- Run `bun test` with zero failures (DB tests skip cleanly without Postgres)
- See a clean `git branch` with only main and active branches

### Entry point / environment

- Entry point: README.md and docs/ directory
- Environment: local dev
- Live dependencies involved: none — all changes are code quality and documentation

## Completion Class

- Contract complete means: tsc passes, tests pass, docs files exist with substantive content
- Integration complete means: README links to docs files that exist and contain accurate information
- Operational complete means: none — no runtime changes

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- `bunx tsc --noEmit` exits 0
- `bun test` has 0 failures (DB-dependent tests skip gracefully)
- docs/ contains architecture.md, configuration.md, knowledge-system.md, and a README index
- CONTRIBUTING.md exists at project root
- .env.example documents all 22+ env vars
- CHANGELOG.md covers v0.17 through v0.25
- `git ls-files data/` returns empty
- `git ls-files .planning/` returns empty
- README.md links to all docs and includes contributor guidance

## Risks and Unknowns

- **review.ts extraction risk** — extracting helpers from a 4,415-line file could break subtle handler flow. Mitigation: only extract pure functions, verify tests pass after each extraction.
- **TS error fixes may require logic changes** — some `Object possibly undefined` errors may need actual null checks that change control flow. Mitigation: use non-null assertions only when the value is genuinely guaranteed; add proper null checks otherwise.
- **.planning/ removal from git tracking** — removing 1028 tracked files in one commit could be large. Mitigation: do it in a dedicated commit with `git rm -r --cached`.

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — 4,415 lines, largest file, extraction target
- `src/handlers/mention.ts` — 2,677 lines, second largest, extraction target
- `src/execution/config.ts` — 911 lines, config schema, source for config docs
- `src/knowledge/` — 63 source files, knowledge system, documentation target
- `src/triage/template-parser.ts` — 15 TS errors, concentrated fix target
- `src/telemetry/types.ts` — stale SQLite comments
- `src/knowledge/db-path.ts` — deprecated, delete target
- `docs/` — 13 existing files (runbooks + smoke tests), no conceptual docs
- `deployment.md` — at project root, should be in docs/
- `.env.example` — 7 vars listed, 22+ actually used
- `data/` — 9 stale SQLite files, not gitignored

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R001-R016 — all active requirements for this milestone
- See `.gsd/REQUIREMENTS.md` for full details

## Scope

### In Scope

- Delete dead/deprecated files and stale SQLite references
- Fix all 474 TypeScript compilation errors
- Light extraction of helpers from god files (review.ts, mention.ts)
- Replace console.log with pino logger in production code
- Graceful test skipping for DB-dependent tests
- Complete .env.example with all env vars
- Archive .planning/ and remove from git tracking
- Clean up merged git branches
- Write architecture documentation
- Write configuration reference documentation
- Write knowledge system documentation
- Write contributing guide
- Update README with contributor focus
- Backfill CHANGELOG v0.17-v0.25
- Move deployment.md into docs/
- Create docs/ index/README

### Out of Scope / Non-Goals

- No runtime behavior changes
- No deep handler restructuring (deferred to future milestone)
- No new features or capabilities
- No phase script renaming
- No formal API documentation (endpoints are webhook receivers)

## Technical Constraints

- Must not change any runtime behavior — all changes are cosmetic/structural
- Tests must continue to pass after every change
- Extracted helpers must be pure functions (no side effects, no state mutation)
- TS fixes should prefer proper null checks over non-null assertions where possible

## Integration Points

- None — this milestone is entirely internal quality and documentation

## Open Questions

- None — all questions resolved during discussion
