---
id: T01
parent: S05
milestone: M026
provides:
  - Contributor-first README with doc links and concise feature summary
key_files:
  - README.md
key_decisions:
  - Grouped features into 8 paragraph-style bullets instead of exhaustive sub-lists
patterns_established:
  - README links to docs/README.md as the documentation hub
observability_surfaces:
  - none
duration: 1 step
verification_result: passed
completed_at: 2026-03-11
blocker_discovered: false
---

# T01: Rewrite README with contributor-first structure

**Rewrote README from 216 lines to 105 lines with contributor-first structure, doc links, and concise feature summary.**

## What Happened

Replaced the feature-heavy 216-line README with a 105-line contributor-oriented document. Structure: project description → quick start (prerequisites, clone, install, .env.example, dev server) → architecture overview paragraph linking docs/architecture.md → concise feature summary (8 paragraph-style bullets) → configuration section linking docs/configuration.md → testing commands → documentation section linking docs/README.md as hub → deployment → contributing link → license.

Updated milestone count from 24/v0.24 to 25/v0.25.

## Verification

- `wc -l < README.md` → 105 (under 200) ✓
- `grep -c 'docs/README.md' README.md` → 1 ✓
- `grep -c 'docs/architecture.md' README.md` → 2 ✓
- `grep -c 'docs/configuration.md' README.md` → 2 ✓
- `grep -c 'CONTRIBUTING.md' README.md` → 1 ✓
- `grep -c 'CHANGELOG.md' README.md` → 1 ✓
- `grep -c '\.env\.example' README.md` → 3 ✓
- All relative links resolve except CONTRIBUTING.md (created in T02)
- Milestone version shows "25 milestones" and "v0.25" ✓

### Slice-level checks

- `test -f README.md` ✓
- `wc -l < README.md` under 200 ✓
- docs/README.md, docs/architecture.md, CONTRIBUTING.md, CHANGELOG.md, .env.example links present ✓
- CONTRIBUTING.md file: not yet created (T02)
- CHANGELOG.md v0.25 entry: not yet created (T03)

## Diagnostics

None — documentation-only change.

## Deviations

None.

## Known Issues

- CONTRIBUTING.md link in README will be broken until T02 creates the file.

## Files Created/Modified

- `README.md` — Rewritten from 216 to 105 lines with contributor-first structure
