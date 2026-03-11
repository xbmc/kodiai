# S01: Dead Code Removal & Repo Hygiene — UAT

**Milestone:** M026
**Written:** 2026-03-11

## UAT Type

- UAT mode: artifact-driven
- Why this mode is sufficient: This slice makes only file-level changes (deletions, moves, config edits, git operations) with no runtime behavior changes. All outcomes are verifiable via filesystem and git state checks.

## Preconditions

- On the gsd/M026/S01 branch with all 3 task commits applied
- Git working tree clean

## Smoke Test

Run `git ls-files .planning/ | wc -l` — must return 0, confirming the largest single change (1029 files untracked) took effect.

## Test Cases

### 1. Deprecated files removed

1. `test -f src/knowledge/db-path.ts && echo FAIL || echo PASS`
2. `test -f src/knowledge/db-path.test.ts && echo FAIL || echo PASS`
3. `test -f test-delta-verification.ts && echo FAIL || echo PASS`
4. `test -f scripts/kodiai-stats.ts && echo FAIL || echo PASS`
5. `test -f scripts/kodiai-trends.ts && echo FAIL || echo PASS`
6. **Expected:** All return PASS

### 2. Stale SQLite references fixed

1. `grep -c 'SQLite' src/telemetry/types.ts`
2. **Expected:** Returns 0

### 3. .gitignore updated

1. `grep -q 'data/' .gitignore && echo PASS || echo FAIL`
2. `grep -q '.planning/' .gitignore && echo PASS || echo FAIL`
3. **Expected:** Both return PASS

### 4. .env.example comprehensive

1. `grep -c '^[A-Z_]*=' .env.example`
2. **Expected:** Returns ≥ 24 (actual: 26)

### 5. deployment.md relocated

1. `test -f docs/deployment.md && echo PASS || echo FAIL`
2. `test -f deployment.md && echo FAIL || echo PASS`
3. **Expected:** Both return PASS

### 6. .planning/ removed from git tracking

1. `git ls-files .planning/ | wc -l`
2. **Expected:** Returns 0

### 7. README references updated

1. `grep '.planning/MILESTONES.md' README.md | wc -l`
2. **Expected:** Returns 0

### 8. Merged branches cleaned

1. `git branch --merged main | grep -v 'main\|\*' | grep -v gsd | wc -l`
2. **Expected:** Returns 0

## Edge Cases

### .planning/ directory still exists locally

1. `test -d .planning && echo EXISTS || echo GONE`
2. **Expected:** EXISTS — directory is preserved on disk, only removed from git tracking. This is intentional.

## Failure Signals

- Any deprecated file still exists on disk
- `git ls-files .planning/` returns non-zero count
- .env.example has fewer than 24 documented vars
- README still contains .planning/ links
- docs/deployment.md missing or root deployment.md still present

## Requirements Proved By This UAT

- R002 — Deprecated files deleted and stale SQLite references corrected (tests 1, 2)
- R003 — .env.example has 26 documented vars with categories (test 4)
- R004 — .gitignore covers data/ and .planning/ (test 3)
- R005 — All merged branches deleted (test 8)
- R011 — deployment.md moved to docs/ (test 5, partial — full docs structure is S03)
- R016 — .planning/ removed from git tracking, README updated (tests 6, 7)

## Not Proven By This UAT

- R003 completeness against actual runtime — no verification that the 26 vars cover every env var the app reads at runtime
- R011 full documentation structure — deployment.md is relocated but docs/README.md index is S03 scope
- No runtime behavior verified — this slice has no runtime changes

## Notes for Tester

All checks are deterministic shell commands. No server, database, or external service needed. Run from the repo root on the slice branch.
