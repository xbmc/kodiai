---
estimated_steps: 4
estimated_files: 1
---

# T01: Rewrite README with contributor-first structure

**Slice:** S05 — README, Contributing & Changelog
**Milestone:** M026

## Description

Rewrite README.md from a feature-heavy listing into a contributor-oriented document. The current 216-line README spends 100+ lines listing every feature but has zero links to docs/, no architecture overview for newcomers, and buried setup instructions. The new README should be under 200 lines, link to docs/README.md as the docs hub, reference .env.example for setup, and provide a concise feature summary instead of an exhaustive catalog.

## Steps

1. Read current README.md to understand existing sections worth preserving (Local Development, Architecture have useful bones)
2. Write new README.md with these sections in order: project description (what Kodiai is), quick start (prerequisites, clone, bun install, .env.example, bun run dev), architecture overview paragraph linking docs/architecture.md, concise feature summary (short bullets grouping capabilities, not exhaustive), configuration link to docs/configuration.md, testing commands (bun test), documentation link to docs/README.md, links to CONTRIBUTING.md and CHANGELOG.md
3. Update milestone count from "24" to "25" and version reference from "v0.24" to "v0.25"
4. Verify all relative links resolve to actual files and line count is under 200

## Must-Haves

- [ ] README under 200 lines
- [ ] Links to docs/README.md, docs/architecture.md, docs/configuration.md
- [ ] Links to CONTRIBUTING.md and CHANGELOG.md
- [ ] References .env.example for environment setup
- [ ] Milestone count updated to 25 milestones / v0.25
- [ ] All relative links resolve to actual files
- [ ] Concise feature summary (not exhaustive list)

## Verification

- `wc -l < README.md` — under 200
- `grep -c 'docs/README.md' README.md` — ≥ 1
- `grep -c 'docs/architecture.md' README.md` — ≥ 1
- `grep -c 'docs/configuration.md' README.md` — ≥ 1
- `grep -c 'CONTRIBUTING.md' README.md` — ≥ 1
- `grep -c 'CHANGELOG.md' README.md` — ≥ 1
- `grep -c '\.env\.example' README.md` — ≥ 1
- Link resolution: all relative links point to existing files

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: Read README.md
- Failure state exposed: None

## Inputs

- Current `README.md` (216 lines) — existing content to restructure
- `docs/README.md` — docs index to link to (created in S03)
- `docs/architecture.md` — architecture doc to link to (created in S03)
- `docs/configuration.md` — config doc to link to (created in S03)
- `.env.example` — env var reference to link to (updated in S01, 26 vars)
- S04 forward intelligence: link to docs/README.md as hub rather than individual doc files

## Expected Output

- `README.md` — rewritten, under 200 lines, with contributor-first structure and all doc links
