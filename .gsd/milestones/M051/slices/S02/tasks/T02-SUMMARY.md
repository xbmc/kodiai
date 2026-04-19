---
id: T02
parent: S02
milestone: M051
key_files:
  - docs/runbooks/review-requested-debug.md
  - docs/configuration.md
  - docs/smoke/phase75-live-ops-verification-closure.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Keep `pull_request.review_requested` documentation only as debug/automatic-review context, not as a supported manual rereview procedure.
  - Avoid hyphenated `kodiai-reviewer` prose in the stale-trigger docs because it contains the `ai-review` substring and can trip the negative grep regression check.
duration: 
verification_result: passed
completed_at: 2026-04-19T00:01:19.511Z
blocker_discovered: false
---

# T02: Removed stale operator docs for the retired rereview-team path so `@kodiai review` is the only documented manual rereview trigger.

**Removed stale operator docs for the retired rereview-team path so `@kodiai review` is the only documented manual rereview trigger.**

## What Happened

I updated `docs/runbooks/review-requested-debug.md` so the runbook now states that explicit PR-scoped `@kodiai review` mentions are the only supported manual rereview procedure. The surviving `pull_request.review_requested` material stays in the document strictly as debug and automatic-review context, and the old rereview-team guidance was removed from the gate-decision and OPS75 evidence sections.

I removed the retired `review.uiRereviewTeam` and `review.requestUiRereviewTeamOnOpen` keys from `docs/configuration.md` and clarified that `review.triggers.onReviewRequested` refers to Kodiai being explicitly requested as a reviewer. I also updated `docs/smoke/phase75-live-ops-verification-closure.md` so OPS75 capture guidance now requires accepted Kodiai reviewer identities and explicitly rejects reviewer-team requests as closure evidence. The checked-in `.kodiai.yml` example was already clean from T01, so I verified that it still contained no stale rereview-team settings instead of changing it again.

While wiring the negative grep verification, I found a docs-only gotcha: the literal phrase `kodiai-reviewer` contains the stale `ai-review` substring and can cause false positives. I recorded that in `.gsd/KNOWLEDGE.md` so future cleanup tasks can avoid tripping the regression check for the wrong reason.

## Verification

I ran the task’s exact verification command over the targeted runbook, configuration doc, smoke doc, and checked-in `.kodiai.yml` example. It exited 0, proving those surfaces no longer contain `uiRereviewTeam`, `requestUiRereviewTeamOnOpen`, `ai-review`, or `aireview`, while the surviving `@kodiai review` manual trigger remains documented in the operator-facing truth surface.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `! rg -n "uiRereviewTeam|requestUiRereviewTeamOnOpen|ai-review|aireview" docs/runbooks/review-requested-debug.md docs/configuration.md docs/smoke/phase75-live-ops-verification-closure.md .kodiai.yml && rg -n "@kodiai review" docs/runbooks/review-requested-debug.md docs/smoke/phase75-live-ops-verification-closure.md` | 0 | ✅ pass | 8ms |

## Deviations

Minor local adaptation: `.kodiai.yml` was already clean from T01, so this task verified the example stayed clean instead of modifying it again.

## Known Issues

None.

## Files Created/Modified

- `docs/runbooks/review-requested-debug.md`
- `docs/configuration.md`
- `docs/smoke/phase75-live-ops-verification-closure.md`
- `.gsd/KNOWLEDGE.md`
