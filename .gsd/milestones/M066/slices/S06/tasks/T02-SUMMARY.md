---
id: T02
parent: S06
milestone: M066
key_files:
  - docs/smoke/m066-formatter-suggestions.md
key_decisions:
  - Use authenticated `gh` CLI as the active T02 operator path because it has repo-scope admin/write/read access on `xbmc/kodiai` while the GitHub bot token helper is unavailable.
  - Carry formatter smoke configuration in the controlled PR head because Kodiai loads `.kodiai.yml` after checking out the PR head and `main` lacks `review.formatterSuggestions.command`.
duration: 
verification_result: mixed
completed_at: 2026-05-05T03:13:37.130Z
blocker_discovered: false
---

# T02: Documented credentialed M066 formatter smoke readiness with controlled PR #134.

**Documented credentialed M066 formatter smoke readiness with controlled PR #134.**

## What Happened

Resolved the T01 environment blocker by finding an authenticated `gh` operator session for `keithah` with repo scope and GitHub API-reported admin/maintain/push/pull permissions on `xbmc/kodiai`. The GitHub bot skill token helper still failed and ambient `GITHUB_*`/Azure smoke variables remain unset, but the existing `gh` authentication is sufficient for PR comment/write and PR review/comment read access. Confirmed `xbmc/kodiai` main lacked `review.formatterSuggestions.command`; because Kodiai checks out the PR head before loading `.kodiai.yml`, created a controlled remote-only smoke PR that carries the minimum PR-head formatter config plus one README whitespace-only hunk. PR #134 is ready for T03 to post `@kodiai format suggestions`; T02 did not post the trigger and did not claim accepted proof. Updated `docs/smoke/m066-formatter-suggestions.md` with a current readiness section, non-secret repo/PR/branch/head SHA/auth/log-correlation details, and pending proof fields for T03/T04.

## Verification

Verified environment/auth state without printing secrets, confirmed repository permissions through GitHub API, created controlled PR #134, read PR metadata/files/reviews/issue comments/review comments through the authenticated API, and checked the smoke artifact for required non-secret prerequisites and stale blocked placeholders. Slice-level `m066_s05_ok` verification was not run because T02 intentionally does not have a real formatter `reviewOutputKey` or delivery id; those are pending T03/T04.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `memory_query credentialed smoke github formatter suggestions docs/smoke` | 1 | ❌ fail | 0ms |
| 2 | `env presence and github-bot token helper capability check` | 0 | ✅ pass | 30000ms |
| 3 | `gh auth status and anonymous open-PR probe for xbmc/kodiai` | 0 | ✅ pass | 30000ms |
| 4 | `read .git/config and gh api repos/xbmc/kodiai permission metadata` | 0 | ✅ pass | 30000ms |
| 5 | `gh api create branch/files/PR for M066 formatter suggestions smoke gate` | 0 | ✅ pass | 180000ms |
| 6 | `gh api read PR #134 metadata/files/reviews/comments and log-correlation target check` | 0 | ✅ pass | 60000ms |
| 7 | `T02 smoke artifact required-field and secret-pattern verification plus PR read-surface verification` | 0 | ✅ pass | 120000ms |
| 8 | `capture_thought PR-head formatter config gotcha` | 1 | ❌ fail | 0ms |

## Deviations

Used the existing authenticated `gh` CLI operator path instead of secure environment collection because auto-mode forbids interactive secret collection. The controlled PR includes PR-head formatter configuration and a tiny smoke formatter script in addition to the README whitespace hunk because `main` did not have `review.formatterSuggestions.command`; this is required for T03 to avoid a setup-needed response.

## Known Issues

Accepted live formatter-suggestion proof is still pending T03/T04. Azure operator environment variables are not present in this shell, so actual deployed revision must be captured from logs after the trigger. The GitHub bot token helper fails with exit 127, and the GSD memory store is malformed/unwritable, so the PR-head config gotcha could not be saved as memory.

## Files Created/Modified

- `docs/smoke/m066-formatter-suggestions.md`
