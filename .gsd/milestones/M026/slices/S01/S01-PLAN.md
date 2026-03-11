# S01: Dead Code Removal & Repo Hygiene

**Goal:** Remove all deprecated files, stale references, and legacy artifacts; complete .env.example; clean up merged branches; update .gitignore; move deployment.md to docs/.
**Demo:** `git ls-files data/ .planning/` returns empty, .env.example has 24+ vars documented, merged branches deleted, deprecated files gone, .gitignore updated.

## Must-Haves

- R002: Deprecated files deleted (db-path.ts, db-path.test.ts, test-delta-verification.ts)
- R002: Stale SQLite references in telemetry/types.ts updated to PostgreSQL
- R003: .env.example expanded from 7 to 24+ vars with descriptions and required/optional status
- R004: .gitignore updated with `data/` and `.planning/` entries
- R005: 7 merged local branches deleted
- R016: .planning/ removed from git tracking via `git rm -r --cached`
- R016: README.md references to .planning/ updated
- S03 boundary: deployment.md moved to docs/deployment.md

## Proof Level

- This slice proves: contract (file existence/absence, config completeness)
- Real runtime required: no
- Human/UAT required: no

## Verification

- `test -f src/knowledge/db-path.ts && echo FAIL || echo PASS` — deprecated file gone
- `test -f test-delta-verification.ts && echo FAIL || echo PASS` — orphan test fixture gone
- `grep -c 'SQLite' src/telemetry/types.ts` returns 0
- `git ls-files .planning/ | wc -l` returns 0
- `grep -c '^[A-Z_]*=' .env.example` returns >= 24
- `grep -q 'data/' .gitignore && echo PASS || echo FAIL`
- `grep -q '.planning/' .gitignore && echo PASS || echo FAIL`
- `git branch --merged main | grep -v 'main' | wc -l` returns 0 (excluding current branch)
- `test -f docs/deployment.md && echo PASS || echo FAIL`
- `test -f deployment.md && echo FAIL || echo PASS` — root deployment.md gone
- `grep '.planning/MILESTONES.md' README.md | wc -l` returns 0

## Observability / Diagnostics

- Runtime signals: none (no runtime changes)
- Inspection surfaces: none
- Failure visibility: none
- Redaction constraints: none

## Integration Closure

- Upstream surfaces consumed: none (first slice)
- New wiring introduced in this slice: none (file-level changes only)
- What remains before the milestone is truly usable end-to-end: S02 (TS fixes), S03 (architecture docs), S04 (feature docs), S05 (README/contributing/changelog)

## Tasks

- [x] **T01: Delete deprecated files and fix stale comments** `est:15m`
  - Why: R002 — dead code and stale SQLite references mislead contributors about the actual storage backend
  - Files: `src/knowledge/db-path.ts`, `src/knowledge/db-path.test.ts`, `test-delta-verification.ts`, `src/telemetry/types.ts`
  - Do: Delete 3 files. Update 3 SQLite→PostgreSQL references in telemetry/types.ts. Verify no production code imports db-path.ts before deleting.
  - Verify: deleted files don't exist; `grep -c 'SQLite' src/telemetry/types.ts` returns 0
  - Done when: no deprecated files remain, all SQLite references in comments corrected

- [x] **T02: Update .gitignore, expand .env.example, and move deployment.md** `est:20m`
  - Why: R003 (env var documentation), R004 (.gitignore completeness), S03 boundary (deployment.md relocation)
  - Files: `.gitignore`, `.env.example`, `deployment.md`, `docs/deployment.md`
  - Do: Add `data/` and `.planning/` to .gitignore. Rewrite .env.example with all 24 env vars grouped by category with descriptions and required/optional markers. Move deployment.md to docs/deployment.md via git mv.
  - Verify: .gitignore has both entries; .env.example has 24+ vars; docs/deployment.md exists; root deployment.md gone
  - Done when: .gitignore covers all generated dirs, .env.example is comprehensive, deployment.md relocated

- [x] **T03: Archive .planning/ from git, update README, and delete merged branches** `est:15m`
  - Why: R016 (.planning/ removal), R005 (stale branches), R007 support (README accuracy)
  - Files: `.planning/` (git rm --cached), `README.md`
  - Do: `git rm -r --cached .planning/` in a dedicated commit. Update README.md lines 216-218 to remove .planning/ references (point to CHANGELOG.md or .gsd/ as appropriate). Delete 7 merged local branches. Ask user before deleting any remote branches.
  - Verify: `git ls-files .planning/ | wc -l` returns 0; README has no .planning/ links; `git branch --merged main | grep -v main` is empty
  - Done when: .planning/ untracked, README updated, merged branches cleaned

## Files Likely Touched

- `src/knowledge/db-path.ts` (delete)
- `src/knowledge/db-path.test.ts` (delete)
- `test-delta-verification.ts` (delete)
- `src/telemetry/types.ts` (edit comments)
- `.gitignore` (add entries)
- `.env.example` (rewrite)
- `deployment.md` (move to docs/)
- `docs/deployment.md` (created by move)
- `.planning/` (git rm --cached)
- `README.md` (update references)
