# S05: Reaction Tracking

**Goal:** Create the reaction tracking infrastructure: a PostgreSQL table for reaction snapshots, a standalone sync script that polls GitHub reactions on triage comments and feeds them into the Bayesian threshold learner, and a GitHub Actions nightly cron workflow.
**Demo:** Create the reaction tracking infrastructure: a PostgreSQL table for reaction snapshots, a standalone sync script that polls GitHub reactions on triage comments and feeds them into the Bayesian threshold learner, and a GitHub Actions nightly cron workflow.

## Must-Haves


## Tasks

- [x] **T01: 114-reaction-tracking 01** `est:2min`
  - Create the reaction tracking infrastructure: a PostgreSQL table for reaction snapshots, a standalone sync script that polls GitHub reactions on triage comments and feeds them into the Bayesian threshold learner, and a GitHub Actions nightly cron workflow.

Purpose: Reactions on triage comments provide a secondary feedback signal for threshold learning. When users thumbs-down a duplicate prediction, it's a false positive signal. When they thumbs-up, it confirms the prediction. This supplements the primary closure-based signal from the issue-closed handler (Phase 112/113), especially for issues that remain open.

Output: Migration 019, `scripts/sync-triage-reactions.ts`, `.github/workflows/nightly-reaction-sync.yml`.

## Files Likely Touched

- `src/db/migrations/019-triage-comment-reactions.sql`
- `src/db/migrations/019-triage-comment-reactions.down.sql`
- `scripts/sync-triage-reactions.ts`
- `.github/workflows/nightly-reaction-sync.yml`
