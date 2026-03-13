# GSD State

**Active Milestone:** M028 — Wiki Modification-Only Publishing
**Active Slice:** Planning complete
**Active Task:** None — roadmap recorded
**Phase:** M028 planned; next action is S01 execution on the modification artifact contract through the real generate + publish-dry-run path

## Recent Decisions
- M028 retires contract risk first through the real generate + publish-dry-run entrypoints before any live GitHub retrofit mutation work.
- M028 models wiki updates as first-class modification artifacts with explicit `section` vs `page` scope and keeps replacement text separate from citations/trace metadata.
- M028 retrofit work requires durable comment identity or deterministic marker scanning so existing suggestion-style wiki comments can be superseded reproducibly and idempotently.
- M028 final acceptance must prove both future modification-only publication and historical suggestion-comment supersession through the real `xbmc/wiki` tracking-issue workflow, with regression guards that fail on any reintroduced `WHY:` or opinion-style prose.
- M027 closes only from the passing live `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json` proof, not from inferred readiness or subordinate slice completion alone.
- `issue_comments` remains an intentional audited-only / repairable boundary outside the current live retriever participant set; M027 proved that boundary truthfully rather than changing it.

## Blockers
- None

## Next Action
Execute S01 from `.gsd/milestones/M028/M028-ROADMAP.md`: replace the wiki suggestion-shaped generation/storage/render contract with explicit modification artifacts and prove the new contract through `scripts/generate-wiki-updates.ts` plus `scripts/publish-wiki-updates.ts --dry-run`.

## Completed Milestones
- M027: Embedding Integrity & Timeout Hardening — closed by the passing live S04 proof (`m027_s04_ok`) with six-corpus audit green, live retriever hits, durable wiki/non-wiki repair-state evidence, and truthful `issue_comments` audited-only scope.
- M026: Codebase Audit & Documentation — 474 TS errors fixed (0 remaining), 7 docs files written, CONTRIBUTING.md created, .env.example expanded to 26 vars, dead code removed, .planning/ untracked, all merged branches cleaned. All 16 requirements (R001-R016) validated. v0.26 shipped.
