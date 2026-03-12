# S05: README, Contributing & Changelog — UAT

**Milestone:** M026
**Written:** 2026-03-11

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice produces only documentation files (README.md, CONTRIBUTING.md, CHANGELOG.md) with no runtime behavior — correctness is verified by file existence, content grep checks, and link resolution

## Preconditions

- Repository cloned with all docs/ files from S03 and S04 present
- .env.example exists (from S01)
- CHANGELOG.md exists with prior entries

## Smoke Test

Run `grep -oP '\[.*?\]\(((?!http)[^)]+)\)' README.md | grep -oP '\(([^)]+)\)' | tr -d '()' | while read f; do test -e "$f" || echo "BROKEN: $f"; done` — no output means all README links resolve.

## Test Cases

### 1. README structure and length

1. `wc -l < README.md`
2. **Expected:** Under 200 lines (actual: 105)

### 2. README links to all documentation

1. `grep -c 'docs/README.md' README.md`
2. `grep -c 'docs/architecture.md' README.md`
3. `grep -c 'docs/configuration.md' README.md`
4. `grep -c 'CONTRIBUTING.md' README.md`
5. `grep -c 'CHANGELOG.md' README.md`
6. `grep -c '\.env\.example' README.md`
7. **Expected:** All counts ≥ 1

### 3. README link resolution

1. Extract all relative links from README.md
2. Check each file exists on disk
3. **Expected:** No broken links

### 4. CONTRIBUTING.md content

1. `grep -c 'bun test' CONTRIBUTING.md`
2. `grep -c 'TEST_DATABASE_URL' CONTRIBUTING.md`
3. `grep -c 'architecture.md' CONTRIBUTING.md`
4. **Expected:** All counts ≥ 1

### 5. CHANGELOG v0.25 entry

1. `grep -c 'v0\.25' CHANGELOG.md`
2. **Expected:** ≥ 1

## Edge Cases

### No LICENSE file referenced

1. `grep -c 'LICENSE' CONTRIBUTING.md`
2. **Expected:** 0 (no LICENSE file exists in repo)

## Failure Signals

- Any broken relative link in README.md
- CONTRIBUTING.md missing testing or architecture references
- CHANGELOG.md missing v0.25 entry
- README exceeding 200 lines

## Requirements Proved By This UAT

- R007 — README covers architecture overview, setup, configuration, and links to all docs
- R012 — CONTRIBUTING.md covers dev setup, testing, code style, PR process, and architecture reference
- R013 — CHANGELOG.md has v0.25 entry

## Not Proven By This UAT

- Content accuracy of README feature descriptions (requires human read-through)
- Whether CONTRIBUTING.md instructions actually work for a fresh contributor (requires human walkthrough)
- Completeness of v0.25 CHANGELOG entry relative to all shipped features (requires human judgment)

## Notes for Tester

- All 12 automated verification checks pass. Human review should focus on:
  - Is the README a good first impression for an open-source contributor?
  - Are the CONTRIBUTING.md setup steps accurate and complete?
  - Does the CHANGELOG v0.25 entry capture the most important deliverables?
- No LICENSE file exists — this is intentional and CONTRIBUTING.md correctly avoids referencing one.
