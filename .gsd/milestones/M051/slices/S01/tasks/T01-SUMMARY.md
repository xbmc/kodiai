---
id: T01
parent: S01
milestone: M051
key_files:
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Treat GitHub team topology proof and human operator-path proof as separate evidence classes for manual rereview.
  - Do not use self-generated open-time rereview-team events as evidence for or against the manual UI trigger path because `src/webhook/filters.ts` intentionally drops app self-events.
duration: 
verification_result: passed
completed_at: 2026-04-18T23:23:20.274Z
blocker_discovered: false
---

# T01: Audited the rereview topology and proved that `aireview` currently includes `kodiai`, narrowing the remaining contract question to operator-path proof rather than missing team wiring.

**Audited the rereview topology and proved that `aireview` currently includes `kodiai`, narrowing the remaining contract question to operator-path proof rather than missing team wiring.**

## What Happened

I executed the audit as an evidence-gathering task rather than a code-change task. First I read the slice/task plan, the review_requested runbook, `.kodiai.yml`, the review handler, the rereview-team helper, the config schema, and the existing handler/helper tests to capture what the repo currently claims. Those local surfaces are consistent: `.kodiai.yml` configures `review.uiRereviewTeam: aireview` with `requestUiRereviewTeamOnOpen: true`; `docs/configuration.md` says humans can remove and re-request that team to retrigger review; `docs/runbooks/review-requested-debug.md` documents `ai-review` / `aireview` as an accepted UI rereview lane; `src/handlers/review.ts` accepts `pull_request.review_requested` when `requested_team` is `ai-review` or `aireview`; and `src/handlers/rereview-team.ts` normalizes both aliases and can fall back from one slug to the other.

I then gathered live GitHub evidence for the actual reviewer/team topology. Issue #84 is still open and still states the problem as “UI rereview team path does not actually target Kodiai,” but the current GitHub API state contradicts that starting assumption: `gh api repos/xbmc/kodiai/teams` returned the `aireview` team with repo access, `gh api orgs/xbmc/teams/aireview/members` returned both `keithah` and `kodiai` as members, and `gh api users/kodiai` showed `kodiai` is a real GitHub user account under `@xbmc`. That means the strongest removal premise — “the team path cannot target Kodiai because Kodiai is not on the team” — is no longer true in the current topology.

The remaining nuance is operational, not topological. `src/handlers/review.ts` explicitly notes that the open-time auto-requested rereview team event will be sent by the app itself, and `src/webhook/filters.ts` intentionally filters app self-events. So a self-generated team request on PR open cannot be used as proof that the human manual UI rereview lane is broken; only a human remove/re-request action can produce the operator-path evidence the slice still needs. I captured that distinction in `.gsd/KNOWLEDGE.md` so future work does not repeat the stale assumption from issue #84.

This task therefore delivered the decision input T02 needs: the repo’s documented/code-tested team rereview path is still wired and the live GitHub topology can reach `kodiai`, but this task did not capture a fresh human-generated `pull_request.review_requested` delivery proving the operator path end-to-end. The keep/remove decision now needs to be framed around supported-proof policy, not around missing team membership.

## Verification

I verified the audit with fresh GitHub CLI evidence, targeted repo inspection, and executable contract tests. `gh issue view 84 -R xbmc/kodiai --json number,title,state,url` confirmed the issue is still open and still framed around the old “does not target Kodiai” premise. A live topology probe using `gh api repos/xbmc/kodiai/teams`, `gh api orgs/xbmc/teams/aireview/members`, and `gh api users/kodiai` proved that `aireview` exists on the repo with push access and currently includes `kodiai` as a member. A targeted `rg -n` sweep across `docs/runbooks/review-requested-debug.md`, `docs/configuration.md`, `.kodiai.yml`, `src/handlers/review.ts`, `src/handlers/rereview-team.ts`, `src/execution/config.ts`, `src/webhook/filters.ts`, and the relevant test files confirmed that the repo still documents and implements the UI team rereview contract, while also proving that app self-events are intentionally filtered. Finally, `bun test src/handlers/rereview-team.test.ts src/handlers/review.test.ts --test-name-pattern 'rereview|ui rereview team request'` passed 7/7 tests, confirming the helper/handler/test contract still accepts `ai-review` / `aireview` and auto-requests the configured rereview team on PR open.

The only remaining gap after T01 is a fresh human-generated `requested_team` delivery proving the operator lane end-to-end; that gap is explicitly documented rather than hidden.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `gh issue view 84 -R xbmc/kodiai --json number,title,state,url --jq '{number,title,state,url}'` | 0 | ✅ pass | 437ms |
| 2 | `bun -e 'const cmds=[["gh","api","repos/xbmc/kodiai/teams"],["gh","api","orgs/xbmc/teams/aireview/members"],["gh","api","users/kodiai"]]; for (const cmd of cmds){ const proc=Bun.spawnSync(cmd,{stdout:"pipe",stderr:"pipe"}); if(proc.exitCode!==0){ console.error(new TextDecoder().decode(proc.stderr)); process.exit(proc.exitCode);} const data=JSON.parse(new TextDecoder().decode(proc.stdout)); if(cmd[2]==="repos/xbmc/kodiai/teams") console.log("teams", data.map(t=>({slug:t.slug, permission:t.permission}))); else if(cmd[2]==="orgs/xbmc/teams/aireview/members") console.log("members", data.map(m=>({login:m.login, type:m.type}))); else console.log("kodiai-user", {login:data.login, type:data.type, company:data.company}); }'` | 0 | ✅ pass | 1164ms |
| 3 | `rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview|Accepted review_requested event for rereview team|drops self-events|Filtered: event from app itself|Humans can remove and re-request the team|UI-only retrigger|Accepted path \(team-based rereview\)" docs/runbooks/review-requested-debug.md docs/configuration.md .kodiai.yml src/handlers/review.ts src/handlers/rereview-team.ts src/handlers/review.test.ts src/handlers/rereview-team.test.ts src/execution/config.ts src/webhook/filters.ts` | 0 | ✅ pass | 7ms |
| 4 | `bun test src/handlers/rereview-team.test.ts src/handlers/review.test.ts --test-name-pattern 'rereview|ui rereview team request'` | 0 | ✅ pass | 381ms |

## Deviations

None.

## Known Issues

No live human-generated `pull_request.review_requested` delivery was captured during T01, so this task proves current topology and repo-side contract but not a fresh end-to-end operator-trigger run.

## Files Created/Modified

- `.gsd/KNOWLEDGE.md`
