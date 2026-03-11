# T02: 113-threshold-learning 02

**Slice:** S04 — **Milestone:** M023

## Description

Wire the threshold-learner module into the issue-opened and issue-closed handlers. The issue-opened handler reads the effective threshold (learned or config fallback) instead of the static config value. The issue-closed handler records observations into the Bayesian state after inserting outcomes.

Purpose: Connects the learning engine to the live system. Without this wiring, the threshold-learner module exists but is never called -- thresholds remain static and no observations accumulate.

Output: Modified `issue-opened.ts` and `issue-closed.ts` with threshold-learner integration, structured logging, and updated tests.

## Must-Haves

- [ ] "issue-opened handler reads effective threshold from getEffectiveThreshold() instead of static config value"
- [ ] "issue-opened handler falls back to config threshold when Bayesian state unavailable or insufficient"
- [ ] "issue-closed handler calls recordObservation() after outcome insert when triage_id IS NOT NULL"
- [ ] "issue-closed handler does NOT call recordObservation() when triage_id is NULL (untriaged issues)"
- [ ] "Structured log emitted during threshold resolution showing source, value, and alpha/beta when learned"
- [ ] "getEffectiveThreshold failure is fail-open (falls back to config, does not crash handler)"

## Files

- `src/handlers/issue-opened.ts`
- `src/handlers/issue-closed.ts`
- `src/handlers/issue-closed.test.ts`
- `src/handlers/issue-opened.test.ts`
