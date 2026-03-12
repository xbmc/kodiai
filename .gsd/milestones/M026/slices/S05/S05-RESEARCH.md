# S05: README, Contributing & Changelog — Research

**Date:** 2026-03-11

## Summary

S05 owns three deliverables: a rewritten README with contributor focus (R007), a new CONTRIBUTING.md (R012), and a CHANGELOG backfill to v0.25 (R013). The existing README is 216 lines, feature-rich but contributor-hostile — it lists capabilities extensively but has zero links to docs/, no architecture overview for newcomers, and buried setup instructions. CONTRIBUTING.md doesn't exist. The CHANGELOG already covers v0.1 through v0.24.1 (336 lines) and only needs v0.25 added.

The work is straightforward documentation writing with no code changes. The main risk is getting the README structure right — balancing feature discovery for evaluators with contributor onboarding for developers. All source material exists: docs/ has 6 substantive files, .env.example has 26 vars, package.json has all scripts, and PROJECT.md has full release history for the v0.25 changelog entry.

## Recommendation

Split into three tasks:

1. **T01: README rewrite** — Restructure README with contributor-first orientation: concise feature summary (not the current exhaustive list), prominent links to docs/README.md for deep dives, complete setup instructions referencing .env.example, testing/typecheck commands, and architecture overview paragraph linking to docs/architecture.md. Keep it under 200 lines.

2. **T02: CONTRIBUTING.md** — New file at project root covering: dev setup prerequisites, running tests, code style (TypeScript strict, pino logging, Zod schemas), PR process, module ownership overview pointing to docs/architecture.md, and testing conventions (bun:test, TEST_DATABASE_URL skip pattern).

3. **T03: CHANGELOG v0.25** — Add v0.25 entry. The CHANGELOG already has v0.17-v0.24.1; only v0.25 (Wiki Content Updates, shipped 2026-03-07) is missing. Source from PROJECT.md release history. Also update README milestone count from "24" to "25".

## Don't Hand-Roll

No external libraries or tools needed. Pure documentation work.

## Existing Code and Patterns

- `README.md` — Current 216 lines. Feature-heavy, contributor-light. Has good "Local Development" and "Architecture" sections to preserve/refine. Links to `deployment.md` (should be `docs/deployment.md`). References `CHANGELOG.md` but says "v0.1 through v0.24" (needs v0.25 update).
- `CHANGELOG.md` — 336 lines, v0.1-v0.24.1. Follows Keep a Changelog format with `## vX.Y (date)` headers and `### Added` subsections. v0.25 entry needed.
- `docs/README.md` — Documentation index with 5 sections, 20 linked files. README should link here as the docs hub rather than listing individual doc files.
- `docs/architecture.md` — 22-section system design doc. README should reference this for deep dive.
- `docs/configuration.md` — 81-section config reference. README config section should point here.
- `.env.example` — 26 vars in 9 categories. README setup should reference this directly.
- `package.json` — Scripts: `dev`, `start`, `report`, various `verify:*` and `backfill:*`. README should document `dev` and `start` and `bun test`.
- `.gsd/PROJECT.md` — Has v0.25 release details in a `<details>` block: "Wiki Content Updates (2026-03-07)", phases 120-126, 7 deliverables.

## Constraints

- No code changes — documentation only
- README target audience is open-source contributors (per M026-CONTEXT.md)
- CHANGELOG follows existing Keep a Changelog format (`## vX.Y (date)` / `### Added`)
- CONTRIBUTING.md must reference docs/architecture.md and testing conventions
- No LICENSE file exists — CONTRIBUTING.md should not reference one
- All doc links must resolve to actual files (verified by checking docs/ contents)

## Common Pitfalls

- **README feature bloat** — Current README spends 100+ lines listing every feature. Contributors need architecture orientation, not feature catalogs. Move feature details to a concise summary with doc links.
- **Stale links** — README currently references `deployment.md` at root (should be `docs/deployment.md` since S01 moved it). Must verify all links resolve.
- **CHANGELOG gap confusion** — The roadmap says "backfill v0.17 through v0.25" but v0.17-v0.24.1 already exist. Only v0.25 is actually missing. Don't duplicate existing entries.
- **Inconsistent milestone count** — README says "24 milestones shipped (v0.1 through v0.24)" but v0.25 is shipped. Update to 25.

## Open Risks

- README length management — restructuring 216 lines of feature content into a contributor-friendly format while keeping it informative. Mitigation: use a feature summary table or short bullets with links to docs.
- CONTRIBUTING.md accuracy — must reflect actual dev workflow (bun, not npm/yarn; TEST_DATABASE_URL for DB tests; bunfig.toml test config). Source from actual project files.

## Skills Discovered

No specialized skills needed — this is pure markdown documentation work. The available `frontend-design` and `swiftui` skills are not relevant.

## Sources

- Current README.md (216 lines) — feature content, setup instructions, architecture section
- CHANGELOG.md (336 lines, v0.1-v0.24.1) — existing format and entries
- .gsd/PROJECT.md — v0.25 release details for changelog backfill
- docs/README.md — documentation index structure (20 files across 5 sections)
- docs/architecture.md, docs/configuration.md — cross-link targets for README and CONTRIBUTING.md
- .env.example (51 lines, 26 vars) — setup reference
- package.json — scripts and dependencies for dev setup docs
