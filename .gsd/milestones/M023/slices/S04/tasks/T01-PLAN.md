# T01: 113-threshold-learning 01

**Slice:** S04 — **Milestone:** M023

## Description

Create the database migration for per-repo Bayesian threshold state and implement the pure threshold-learner module with Beta-Binomial updating, sample gate, and clamping.

Purpose: This is the learning engine for duplicate detection. Without it, the threshold is a static config value that cannot adapt to a repo's actual false positive/negative rate. The Beta-Binomial model is the simplest Bayesian approach -- two counters (alpha, beta) that update with each observation.

Output: Migration 018, `src/triage/threshold-learner.ts` with pure functions + DB-boundary functions, and comprehensive tests.

## Must-Haves

- [ ] "Beta-Binomial state (alpha, beta_, sample_count) is stored per repo in triage_threshold_state"
- [ ] "classifyOutcome correctly maps all four confusion matrix quadrants (TP, FP, FN, TN)"
- [ ] "recordObservation atomically increments alpha or beta_ via SQL UPSERT (no read-then-write race)"
- [ ] "getEffectiveThreshold returns config fallback when sample_count < 20 (LEARN-02)"
- [ ] "getEffectiveThreshold clamps returned threshold to [50, 95] range (LEARN-03)"
- [ ] "With uniform prior (alpha=1, beta=1) and no observations, getEffectiveThreshold returns config fallback"

## Files

- `src/db/migrations/018-triage-threshold-state.sql`
- `src/db/migrations/018-triage-threshold-state.down.sql`
- `src/triage/threshold-learner.ts`
- `src/triage/threshold-learner.test.ts`
