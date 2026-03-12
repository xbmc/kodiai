# S05: README, Contributing & Changelog

**Goal:** Rewrite README with contributor focus, create CONTRIBUTING.md, and backfill CHANGELOG through v0.25
**Demo:** README links to all docs, CONTRIBUTING.md at project root, CHANGELOG has v0.25 entry, all links resolve to real files

## Must-Haves

- README rewritten with contributor-first orientation, architecture overview, setup instructions, and links to docs/README.md
- CONTRIBUTING.md at project root covering dev setup, testing, code style, and PR process
- CHANGELOG.md has v0.25 entry in existing Keep a Changelog format
- All doc links in README resolve to actual files
- README under 200 lines
- Milestone count updated from "24" to "25"

## Proof Level

- This slice proves: contract (documentation files exist with correct content and all links resolve)
- Real runtime required: no
- Human/UAT required: yes (read-through for accuracy and completeness)

## Verification

- `test -f README.md` — exists
- `test -f CONTRIBUTING.md` — exists
- `wc -l < README.md` — under 200 lines
- `grep -c 'docs/README.md' README.md` — at least 1 (links to docs index)
- `grep -c 'docs/architecture.md' README.md` — at least 1
- `grep -c 'CONTRIBUTING.md' README.md` — at least 1
- `grep -c 'CHANGELOG.md' README.md` — at least 1
- `grep -c 'v0\.25' CHANGELOG.md` — at least 1
- `grep -c '\.env\.example' README.md` — at least 1
- `grep -c 'bun test' CONTRIBUTING.md` — at least 1
- `grep -c 'architecture.md' CONTRIBUTING.md` — at least 1
- All links in README resolve: `grep -oP '\[.*?\]\(((?!http)[^)]+)\)' README.md | grep -oP '\(([^)]+)\)' | tr -d '()' | while read f; do test -e "$f" || echo "BROKEN: $f"; done` — no output

## Observability / Diagnostics

- Runtime signals: none (documentation-only slice)
- Inspection surfaces: none
- Failure visibility: none
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: docs/architecture.md, docs/configuration.md, docs/deployment.md, docs/knowledge-system.md, docs/issue-intelligence.md, docs/guardrails.md, docs/README.md (from S03/S04), .env.example (from S01), CHANGELOG.md (existing)
- New wiring introduced in this slice: none (documentation only)
- What remains before the milestone is truly usable end-to-end: nothing — S05 is the final slice

## Tasks

- [x] **T01: Rewrite README with contributor-first structure** `est:25m`
  - Why: Current README is feature-heavy but contributor-hostile — no doc links, buried setup, no architecture overview for newcomers (R007)
  - Files: `README.md`
  - Do: Restructure into concise sections: project description, quick start (link .env.example), architecture overview paragraph (link docs/architecture.md), feature summary (short bullets, not exhaustive list), configuration (link docs/configuration.md), testing commands, full docs link (docs/README.md), contributing link, changelog link. Update milestone count to 25. Keep under 200 lines. Verify all relative links resolve.
  - Verify: `wc -l < README.md` under 200, `grep -c 'docs/README.md' README.md` ≥ 1, link resolution check passes
  - Done when: README under 200 lines with links to all docs, CONTRIBUTING.md, CHANGELOG.md, and .env.example — all links resolve

- [x] **T02: Create CONTRIBUTING.md** `est:20m`
  - Why: No contributing guide exists — open-source contributors need onboarding for dev setup, testing, and PR process (R012)
  - Files: `CONTRIBUTING.md`
  - Do: Write CONTRIBUTING.md covering: prerequisites (Bun, Node, PostgreSQL optional), dev setup (clone, bun install, copy .env.example), running the app (bun run dev), testing (bun test, TEST_DATABASE_URL for DB tests, describe.skipIf pattern), code style (TypeScript strict, pino logging, Zod schemas), PR process, module overview pointing to docs/architecture.md, and testing conventions (bun:test, bunfig.toml). Do not reference a LICENSE file (none exists).
  - Verify: `test -f CONTRIBUTING.md`, `grep -c 'bun test' CONTRIBUTING.md` ≥ 1, `grep -c 'architecture.md' CONTRIBUTING.md` ≥ 1
  - Done when: CONTRIBUTING.md exists at project root with setup, testing, code style, and PR guidance

- [x] **T03: Backfill CHANGELOG v0.25 and run slice verification** `est:15m`
  - Why: CHANGELOG covers v0.1–v0.24.1 but v0.25 is missing (R013); also need to run full slice verification
  - Files: `CHANGELOG.md`
  - Do: Add v0.25 entry at top of CHANGELOG following existing format (`## v0.25 (2026-03-07)` / `### Added`). Source content from PROJECT.md v0.25 release details. Run all slice verification checks.
  - Verify: `grep -c 'v0\.25' CHANGELOG.md` ≥ 1, all 12 slice verification checks pass
  - Done when: CHANGELOG has v0.25 entry and all slice verification checks pass

## Files Likely Touched

- `README.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
