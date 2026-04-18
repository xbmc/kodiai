# S01: Rereview trigger proof and decision — UAT

**Milestone:** M051
**Written:** 2026-04-18T23:45:37.677Z

# UAT — M051/S01 manual rereview trigger proof and decision

## Preconditions

- Local checkout includes the M051/S01 outputs and rendered S02 plan artifacts.
- `gh` is authenticated with access to `xbmc/kodiai` and `xbmc` team metadata.
- `bun` is available locally.

## Test Case 1 — Prove the live GitHub rereview topology

1. Run:
   - `gh api repos/xbmc/kodiai/teams`
   - `gh api orgs/xbmc/teams/aireview/members`
   - `gh api users/kodiai`
2. Inspect the returned JSON.

**Expected outcome:**
- `aireview` appears as a team on `xbmc/kodiai`.
- The team has repo access.
- `kodiai` appears in the `aireview` member list.
- `kodiai` resolves to a real GitHub user account.

## Test Case 2 — Prove the repo still encodes the UI-team contract and the explicit mention contract

1. Run the audit grep used during closeout across:
   - `docs/runbooks/review-requested-debug.md`
   - `docs/configuration.md`
   - `.kodiai.yml`
   - `src/handlers/review.ts`
   - `src/handlers/rereview-team.ts`
   - `src/webhook/filters.ts`
   - `src/execution/config.ts`
   - `src/handlers/review.test.ts`
   - `src/handlers/rereview-team.test.ts`
   - `src/handlers/mention.ts`
   - `src/handlers/mention.test.ts`
2. Confirm the output shows both:
   - `ai-review` / `aireview`, `uiRereviewTeam`, and `requestUiRereviewTeamOnOpen`
   - `@kodiai review`

**Expected outcome:**
- The current repo still advertises and tests the UI-team rereview path.
- The repo also clearly preserves `@kodiai review` as an explicit manual review lane.

## Test Case 3 — Prove why open-time auto-requests are not valid operator-path evidence

1. Inspect the audit output for `src/webhook/filters.ts` and `src/handlers/review.ts`.
2. Confirm `src/webhook/filters.ts` contains the app self-event filter (`Filtered: event from app itself`).
3. Confirm `src/handlers/review.ts` still contains the auto-request-on-open rereview team path.

**Expected outcome:**
- The codebase itself shows that self-generated open-time team requests are filtered.
- Reviewers can therefore distinguish topology proof from manual operator proof.
- The slice conclusion must remain: UI-team path is wired but unproven.

## Test Case 4 — Verify the authoritative contract decision and issue guidance

1. Run `rg -n 'D124|D125' .gsd/DECISIONS.md`.
2. Run the latest-comment issue check for issue `#84`.
3. Confirm the latest issue comment includes:
   - `Decision D125`
   - `@kodiai review`
   - a clear instruction not to rely on `ai-review` / `aireview`

**Expected outcome:**
- D124 states that `@kodiai review` is the only supported manual trigger while UI-team proof is missing.
- D125 states that S02 should remove the unsupported UI-team contract.
- Issue `#84` matches the same guidance rather than ending on an unresolved question.

## Test Case 5 — Verify the S02 implementation handoff is concrete

1. Run `find .gsd/milestones/M051/slices/S02 -maxdepth 2 -type f | sort`.
2. Inspect `S02-PLAN.md` and the task plans.
3. Confirm the plan explicitly covers:
   - runtime handler removal
   - config/schema/example cleanup
   - docs/smoke cleanup
   - regression proof for `@kodiai review`

**Expected outcome:**
- `S02-PLAN.md`, `T01-PLAN.md`, `T02-PLAN.md`, and `T03-PLAN.md` all exist.
- The follow-on slice can execute without re-opening the contract decision.

## Edge Cases

- If topology exists but no fresh human-generated `pull_request.review_requested` delivery is available, classify the UI-team lane as **wired but unproven**, not supported.
- If the issue title still states the old broken-topology assumption, the authoritative guidance is the latest D125 closeout comment plus D124/D125 in `.gsd/DECISIONS.md`.
- If explicit mention tests pass while UI-team tests also pass, treat that as proof that S02 still has stale contract surface to remove, not as proof that both manual triggers are operator-supported.
