# M026: Codebase Audit & Documentation

**Vision:** Clean up accumulated technical debt from 25 milestones of feature development — fix all TypeScript errors, remove dead code, write comprehensive documentation for open-source contributors, and leave the codebase in a state where anyone can clone, understand, and contribute.

## Success Criteria

- `bunx tsc --noEmit` exits with zero errors
- `bun test` has zero failures (DB tests skip gracefully without Postgres)
- docs/ contains architecture.md, configuration.md, knowledge-system.md, contributing guide, and index
- .env.example documents every environment variable the app reads
- CHANGELOG.md covers v0.17 through v0.25
- No stale SQLite files, deprecated modules, or dead code remain
- .planning/ removed from git tracking
- Merged git branches cleaned up
- README updated with contributor onboarding and links to all docs

## Key Risks / Unknowns

- **review.ts/mention.ts extraction** — extracting from 4K+ line files risks breaking handler flow
- **TS error volume** — 474 errors across many files could reveal deeper design issues

## Proof Strategy

- review.ts extraction risk → retire in S02 by proving tests pass after each extraction
- TS error volume → retire in S02 by fixing errors file-by-file with test verification

## Verification Classes

- Contract verification: tsc --noEmit, bun test, file existence checks
- Integration verification: none — no runtime changes
- Operational verification: none — no service changes
- UAT / human verification: read-through of generated docs for accuracy and completeness

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 5 slices complete with summaries
- `bunx tsc --noEmit` exits 0
- `bun test` has 0 failures
- docs/ has 5+ substantive markdown files
- CONTRIBUTING.md exists at project root
- .env.example has 20+ documented vars
- CHANGELOG.md covers through v0.25
- README links to all docs
- No files in data/ or .planning/ tracked by git
- Success criteria re-checked against actual state

## Requirement Coverage

- Covers: R001, R002, R003, R004, R005, R006, R007, R008, R009, R010, R011, R012, R013, R014, R015, R016
- Partially covers: none
- Leaves for later: R017 (full handler refactoring), R018 (automated dead code detection)
- Orphan risks: none

## Slices

- [x] **S01: Dead Code Removal & Repo Hygiene** `risk:low` `depends:[]`
  > After this: `git ls-files data/ .planning/` returns empty, .env.example has all vars, merged branches deleted, deprecated files removed, .gitignore updated.

- [ ] **S02: TypeScript Fixes & Code Quality** `risk:medium` `depends:[S01]`
  > After this: `bunx tsc --noEmit` exits 0, `bun test` has 0 failures, console.log replaced with pino in production code, light helper extraction from review.ts and mention.ts verified by passing tests.

- [ ] **S03: Architecture & Operations Docs** `risk:low` `depends:[S01]`
  > After this: docs/architecture.md explains system design and data flow, docs/configuration.md documents all .kodiai.yml options, docs/deployment.md consolidated from root, docs/README.md indexes all docs.

- [ ] **S04: Knowledge System & Feature Docs** `risk:low` `depends:[S03]`
  > After this: docs/knowledge-system.md documents all 5 corpora and retrieval pipeline, docs/issue-intelligence.md covers triage and troubleshooting, docs/guardrails.md covers epistemic system.

- [ ] **S05: README, Contributing & Changelog** `risk:low` `depends:[S03,S04]`
  > After this: README rewritten with contributor focus and links to all docs, CONTRIBUTING.md at project root, CHANGELOG.md backfilled through v0.25.

## Boundary Map

### S01 → S02

Produces:
- Clean repo state: no deprecated files, no stale SQLite refs, no dead imports
- Updated .gitignore covering data/ and .planning/
- Complete .env.example

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- deployment.md moved to docs/deployment.md
- Clean file tree for accurate architecture documentation

Consumes:
- nothing (first slice)

### S02 → S05

Produces:
- Zero tsc errors (clean type surface for documentation accuracy)
- Extracted helper modules from review.ts/mention.ts (cleaner module list for architecture docs)

Consumes from S01:
- Clean codebase without dead files

### S03 → S04

Produces:
- docs/architecture.md (knowledge system docs reference this for overall context)
- docs/README.md index (feature docs get added to this index)
- docs/ directory structure established

Consumes from S01:
- deployment.md in docs/

### S03 → S05

Produces:
- docs/architecture.md, docs/configuration.md (README links to these)
- Established docs structure

Consumes from S01:
- Clean repo state

### S04 → S05

Produces:
- docs/knowledge-system.md, docs/issue-intelligence.md, docs/guardrails.md (README links to these)

Consumes from S03:
- docs/ structure and index
