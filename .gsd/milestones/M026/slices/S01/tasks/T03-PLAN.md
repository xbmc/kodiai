---
estimated_steps: 5
estimated_files: 2
---

# T03: Archive .planning/ from git, update README, and delete merged branches

**Slice:** S01 — Dead Code Removal & Repo Hygiene
**Milestone:** M026

## Description

Remove .planning/ (1029 files, 11MB) from git tracking without deleting the local directory. Update README.md to remove broken .planning/ references. Delete 7 merged local branches. Ask user before deleting remote branches.

## Steps

1. `git rm -r --cached .planning/` — removes from tracking, keeps local files
2. Commit: `chore(S01): remove .planning/ from git tracking`
3. Update README.md lines ~216-218: remove the reference to `.planning/MILESTONES.md` and the "Archived planning artifacts" line. Replace with a reference to CHANGELOG.md for release history.
4. Commit: `docs(S01): update README .planning/ references`
5. Delete 7 merged local branches: feat/issue-write-pr, fix/aireview-team-trigger, fix/auto-approve-published, fix/pr10-review-items, temp/enable-issue-write, temp/harden-write-allowpaths, temp/issue-intent-summary-v2. Ask user before deleting any remote merged branches.

## Must-Haves

- [ ] .planning/ not tracked by git (`git ls-files .planning/` returns empty)
- [ ] .planning/ still exists locally (not deleted from disk)
- [ ] README.md has no references to .planning/MILESTONES.md
- [ ] README.md has no broken links to .planning/
- [ ] 7 merged local branches deleted
- [ ] Remote branch deletion only after user confirmation

## Verification

- `git ls-files .planning/ | wc -l` → 0
- `test -d .planning && echo PASS` → PASS (still on disk)
- `grep '.planning/' README.md | wc -l` → 0
- `git branch --merged main | grep -v 'main\|\*' | wc -l` → 0 (no stale merged branches)

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: None
- Failure state exposed: None

## Inputs

- T01 and T02 completed (dead files removed, .gitignore updated)
- S01-RESEARCH.md branch list (7 local merged branches)
- S01-RESEARCH.md README lines (~216-218)

## Expected Output

- `.planning/` — removed from git index (1029 files untracked)
- `README.md` — .planning/ references replaced
- 7 local branches deleted
