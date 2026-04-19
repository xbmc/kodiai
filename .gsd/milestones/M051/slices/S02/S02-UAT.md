# S02: Manual rereview contract implementation — UAT

**Milestone:** M051
**Written:** 2026-04-19T00:14:07.319Z

# UAT — S02 Manual rereview contract implementation

## Preconditions
- Repository is checked out at the M051/S02 slice head.
- Dependencies are installed and `bun` is available.
- Run all commands from the repo root.

## Test Case 1 — Operator docs/config expose only the supported manual trigger
1. Run:
   ```bash
   ! rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview" docs/runbooks/review-requested-debug.md docs/configuration.md docs/smoke/phase75-live-ops-verification-closure.md .kodiai.yml && rg -n "@kodiai review" docs/runbooks/review-requested-debug.md docs/smoke/phase75-live-ops-verification-closure.md
   ```
2. Confirm the command exits 0.
3. Confirm the output contains `@kodiai review` references in the runbook/smoke doc and no `uiRereviewTeam`, `requestUiRereviewTeamOnOpen`, `ai-review`, or `aireview` matches.

**Expected outcome:** the checked-in operator docs and repo config example document only `@kodiai review` as the supported manual rereview path.

## Test Case 2 — Config loading and `review_requested` handling reject the retired team contract
1. Run:
   ```bash
   bun test ./src/handlers/review.test.ts ./src/execution/config.test.ts
   ```
2. Confirm the suite finishes with 0 failures.
3. In the passing output, verify these regressions are present:
   - `skips team-only review requests for ai-review`
   - `skips team-only review requests for aireview`
   - `logs ai-review and aireview team-only review requests as skipped manual triggers`
   - `does not auto-request extra reviewers on opened`
   - `ignores deprecated rereview team keys when loading config`

**Expected outcome:** direct Kodiai reviewer requests still work, deprecated UI-team config keys are ignored, and open events no longer auto-request a rereview team.

## Test Case 3 — `@kodiai review` remains the supported manual rereview path
1. Run:
   ```bash
   bun test ./src/handlers/mention.test.ts ./src/handlers/review.test.ts
   ```
2. Confirm the suite finishes with 0 failures.
3. In the passing output, verify these explicit-manual-trigger checks are present:
   - `@kodiai review uses review task type and review output key`
   - `explicit PR review mention stays on interactive-review/review.full and submits approval review when inspection evidence is present`
   - `@kodiai review triggers executor instead of delegating to aireview team`
4. Confirm the same run still contains the negative `ai-review` / `aireview` team-only skip regressions from `review.test.ts`.

**Expected outcome:** explicit mention review remains on `lane=interactive-review` with `taskType=review.full`, and team-only rerequest deliveries stay rejected.

## Test Case 4 — Typed surface still compiles after the proof-surface changes
1. Run:
   ```bash
   bun run tsc --noEmit
   ```
2. Confirm the command exits 0.

**Expected outcome:** the added mention-log proof fields and removed rereview-team config/runtime surfaces compile cleanly.

## Edge Cases
- If a local repo config still contains removed UI-team keys, the loader should ignore them rather than error or silently re-enable the path.
- If a `pull_request.review_requested` webhook contains only `requested_team=ai-review` or `requested_team=aireview`, Kodiai should log a skipped team-only request and perform no review work.
- If an operator needs to manually rerun review, the supported procedure is a PR-scoped `@kodiai review` mention; team rerequests are no longer supported instructions.
