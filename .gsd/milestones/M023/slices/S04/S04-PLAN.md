# S04: Threshold Learning

**Goal:** Create the database migration for per-repo Bayesian threshold state and implement the pure threshold-learner module with Beta-Binomial updating, sample gate, and clamping.
**Demo:** Create the database migration for per-repo Bayesian threshold state and implement the pure threshold-learner module with Beta-Binomial updating, sample gate, and clamping.

## Must-Haves


## Tasks

- [x] **T01: 113-threshold-learning 01**
  - Create the database migration for per-repo Bayesian threshold state and implement the pure threshold-learner module with Beta-Binomial updating, sample gate, and clamping.

Purpose: This is the learning engine for duplicate detection. Without it, the threshold is a static config value that cannot adapt to a repo's actual false positive/negative rate. The Beta-Binomial model is the simplest Bayesian approach -- two counters (alpha, beta) that update with each observation.

Output: Migration 018, `src/triage/threshold-learner.ts` with pure functions + DB-boundary functions, and comprehensive tests.
- [x] **T02: 113-threshold-learning 02**
  - Wire the threshold-learner module into the issue-opened and issue-closed handlers. The issue-opened handler reads the effective threshold (learned or config fallback) instead of the static config value. The issue-closed handler records observations into the Bayesian state after inserting outcomes.

Purpose: Connects the learning engine to the live system. Without this wiring, the threshold-learner module exists but is never called -- thresholds remain static and no observations accumulate.

Output: Modified `issue-opened.ts` and `issue-closed.ts` with threshold-learner integration, structured logging, and updated tests.

## Files Likely Touched

- `src/db/migrations/018-triage-threshold-state.sql`
- `src/db/migrations/018-triage-threshold-state.down.sql`
- `src/triage/threshold-learner.ts`
- `src/triage/threshold-learner.test.ts`
- `src/handlers/issue-opened.ts`
- `src/handlers/issue-closed.ts`
- `src/handlers/issue-closed.test.ts`
- `src/handlers/issue-opened.test.ts`
