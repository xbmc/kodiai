# S01: Dead Code Removal & Repo Hygiene — Research

**Date:** 2026-03-11

## Summary

S01 is a low-risk housekeeping slice covering five requirements: R002 (dead code removal), R003 (.env.example completeness), R004 (.gitignore updates), R005 (stale branch cleanup), and R016 (.planning/ archive). All changes are non-behavioral — file deletions, config updates, and git operations. The codebase is well-understood and the scope is narrow.

The main work is: delete deprecated files (`src/knowledge/db-path.ts`, `test-delta-verification.ts`), update stale SQLite references in comments, add `data/` and `.planning/` to `.gitignore`, expand `.env.example` from 7 to 24 vars, remove 7 merged branches, and archive `.planning/` out of git tracking. Additionally, `deployment.md` should be moved into `docs/` per S03 boundary map.

## Recommendation

Execute as a single linear pass: (1) delete dead files, (2) fix stale comments, (3) update .gitignore, (4) expand .env.example, (5) archive .planning/ from git, (6) delete merged branches, (7) move deployment.md to docs/. Each step is independently verifiable. No libraries or complex tooling needed.

## Don't Hand-Roll

No external tools needed. All operations are standard git commands and file edits.

## Existing Code and Patterns

- `src/knowledge/db-path.ts` — Marked `@deprecated`, only imported by its own test file (`db-path.test.ts`). No production code imports it. Safe to delete both files.
- `test-delta-verification.ts` — Root-level test fixture from Phase 33 delta verification. Not imported anywhere. Safe to delete.
- `src/telemetry/types.ts` — Lines 4, 69, 90 reference "telemetry SQLite database" in JSDoc comments. Should say "PostgreSQL database" (storage migrated to Postgres).
- `src/config.ts:78-95` — Canonical source of all env vars loaded at startup. 18 vars here plus DATABASE_URL (db/client.ts), VOYAGE_API_KEY, WIKI_BASE_URL, SHUTDOWN_GRACE_MS, TELEMETRY_RATE_LIMIT_FAILURE_IDENTITIES, CLAUDE_CODE_OAUTH_TOKEN/ENTRYPOINT, ANTHROPIC_API_KEY (index.ts/executor.ts/providers.ts).
- `data/` — Contains 9 stale SQLite files (telemetry DBs from local dev). Not gitignored, not tracked by git. Just needs .gitignore entry.
- `.planning/` — 1028 files, 11MB. Tracked by git. Superseded by `.gsd/`. README.md lines 24 reference it.
- `deployment.md` — 2.8KB at project root. S03 boundary map says move to `docs/deployment.md`.
- `.gitignore` — Already has GSD entries. Missing `data/` and `.planning/`.

## Constraints

- **No runtime behavior changes** — all changes are file deletions, comment fixes, and config updates.
- **Must not break imports** — verify `db-path.ts` has no production importers before deleting (confirmed: only `db-path.test.ts` imports it).
- **Branch deletion is local only** — remote branch cleanup requires user confirmation per GSD hard rules (outward-facing GitHub action).
- **README .planning/ references must be updated** — two lines in README.md reference `.planning/`.

## Common Pitfalls

- **Deleting files still imported** — Always verify no production imports exist before deleting. `db-path.ts` is clean (only test imports). `test-delta-verification.ts` has zero importers.
- **Large git rm --cached commit** — `.planning/` has 1028 files. Use `git rm -r --cached .planning/` in a dedicated commit to keep history clean.
- **Incomplete env var audit** — Easy to miss vars read via `process.env[envVar]` dynamic access patterns. `src/llm/providers.ts` uses this for ANTHROPIC_API_KEY. Audit complete: 24 env vars identified.
- **Remote branch deletion without confirmation** — Merged remote branches exist (3 on origin). Must ask user before deleting remote branches.

## Open Risks

- **Remote branch cleanup scope** — 7 local merged branches can be deleted freely. 3 remote merged branches (origin/feat/issue-write-pr, origin/fix/aireview-team-trigger, fork-kodiai/fix/aireview-team-trigger) need user confirmation. Low risk — just requires a confirmation step.
- **README references to .planning/MILESTONES.md** — After archiving, the link to `.planning/MILESTONES.md` will break. Need to decide: remove the reference or point to .gsd/ equivalent.

## Env Var Inventory (for R003)

Complete list of env vars read by the app (24 total):

| Var | Source | Required | Current in .env.example |
|-----|--------|----------|------------------------|
| GITHUB_APP_ID | config.ts | yes | ✅ |
| GITHUB_PRIVATE_KEY | config.ts | yes (alt) | ❌ |
| GITHUB_PRIVATE_KEY_BASE64 | config.ts | yes (alt) | ✅ |
| GITHUB_WEBHOOK_SECRET | config.ts | yes | ✅ |
| CLAUDE_CODE_OAUTH_TOKEN | config.ts | yes | ✅ |
| PORT | config.ts | no | ✅ |
| LOG_LEVEL | config.ts | no | ✅ |
| BOT_ALLOW_LIST | config.ts | no | ✅ |
| DATABASE_URL | db/client.ts | yes | ❌ |
| VOYAGE_API_KEY | index.ts | no | ❌ |
| SLACK_BOT_TOKEN | config.ts | no | ❌ |
| SLACK_SIGNING_SECRET | config.ts | no | ❌ |
| SLACK_BOT_USER_ID | config.ts | no | ❌ |
| SLACK_KODIAI_CHANNEL_ID | config.ts | no | ❌ |
| SLACK_DEFAULT_REPO | config.ts | no | ❌ |
| SLACK_ASSISTANT_MODEL | config.ts | no | ❌ |
| SLACK_WIKI_CHANNEL_ID | config.ts | no | ❌ |
| BOT_USER_PAT | config.ts | no | ❌ |
| BOT_USER_LOGIN | config.ts | no | ❌ |
| WIKI_BASE_URL | index.ts | no | ❌ |
| WIKI_STALENESS_THRESHOLD_DAYS | config.ts | no | ❌ |
| WIKI_GITHUB_OWNER | config.ts | no | ❌ |
| WIKI_GITHUB_REPO | config.ts | no | ❌ |
| SHUTDOWN_GRACE_MS | index.ts | no | ❌ |
| TELEMETRY_RATE_LIMIT_FAILURE_IDENTITIES | index.ts | no | ❌ |
| ANTHROPIC_API_KEY | llm/providers.ts | no | ❌ |
| CLAUDE_CODE_ENTRYPOINT | executor.ts | no (internal) | ❌ |

7 currently documented, 17 missing. CLAUDE_CODE_ENTRYPOINT is set internally by executor.ts (not user-configured) — document but mark as internal.

## Files to Delete

| File | Reason | Importers |
|------|--------|-----------|
| `src/knowledge/db-path.ts` | @deprecated, superseded by db/client.ts | only db-path.test.ts |
| `src/knowledge/db-path.test.ts` | Tests for deprecated module | none |
| `test-delta-verification.ts` | Phase 33 test fixture, orphaned at root | none |

## Comments to Update

| File | Line(s) | Current | New |
|------|---------|---------|-----|
| `src/telemetry/types.ts` | 4 | "telemetry SQLite database" | "telemetry PostgreSQL database" |
| `src/telemetry/types.ts` | 69 | "telemetry SQLite database" | "telemetry PostgreSQL database" |
| `src/telemetry/types.ts` | 90 | "telemetry SQLite database" | "telemetry PostgreSQL database" |

## Branches to Delete (Local)

7 merged into main:
- `feat/issue-write-pr`
- `fix/aireview-team-trigger`
- `fix/auto-approve-published`
- `fix/pr10-review-items`
- `temp/enable-issue-write`
- `temp/harden-write-allowpaths`
- `temp/issue-intent-summary-v2`

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript/Bun | — | none needed (standard tooling) |
| Git operations | — | none needed (standard git) |

## Sources

- Codebase grep for `process.env.` across src/ (24 unique env vars identified)
- `git branch --merged main` (7 merged local branches)
- `git ls-files .planning/` (1028 tracked files, 11MB)
- `rg '@deprecated' src/` (db-path.ts confirmed deprecated, wiki-update-generator.ts is active)
- `rg 'db-path' src/` (only db-path.test.ts imports db-path.ts)
