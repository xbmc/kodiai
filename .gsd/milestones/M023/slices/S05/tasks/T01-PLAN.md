# T01: 114-reaction-tracking 01

**Slice:** S05 — **Milestone:** M023

## Description

Create the reaction tracking infrastructure: a PostgreSQL table for reaction snapshots, a standalone sync script that polls GitHub reactions on triage comments and feeds them into the Bayesian threshold learner, and a GitHub Actions nightly cron workflow.

Purpose: Reactions on triage comments provide a secondary feedback signal for threshold learning. When users thumbs-down a duplicate prediction, it's a false positive signal. When they thumbs-up, it confirms the prediction. This supplements the primary closure-based signal from the issue-closed handler (Phase 112/113), especially for issues that remain open.

Output: Migration 019, `scripts/sync-triage-reactions.ts`, `.github/workflows/nightly-reaction-sync.yml`.

## Must-Haves

- [ ] "A nightly cron job polls GitHub reactions on recent triage comments and stores thumbs_up/thumbs_down counts"
- [ ] "Reaction data feeds into the Bayesian threshold learning system via recordObservation as a secondary signal"
- [ ] "Reaction-based observations are only recorded when reaction counts have changed AND no issue_outcome_feedback closure record exists (avoids double-counting)"
- [ ] "Pre-Phase 112 triage records with NULL comment_github_id are gracefully skipped"
- [ ] "Bot reactions are filtered out (only human thumbs up/down counted)"
- [ ] "The sync script follows the standalone script pattern from backfill-issues.ts"
- [ ] "The GitHub Actions workflow follows the nightly-issue-sync.yml pattern"

## Files

- `src/db/migrations/019-triage-comment-reactions.sql`
- `src/db/migrations/019-triage-comment-reactions.down.sql`
- `scripts/sync-triage-reactions.ts`
- `.github/workflows/nightly-reaction-sync.yml`
