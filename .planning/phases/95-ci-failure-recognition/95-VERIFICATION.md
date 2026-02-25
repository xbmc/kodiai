---
phase: 95-ci-failure-recognition
status: passed
verified: 2026-02-25
requirements: [CIFR-01, CIFR-02, CIFR-03, CIFR-04, CIFR-05]
---

# Phase 95: CI Failure Recognition — Verification

## Goal

Kodiai annotates CI failures that appear unrelated to the PR, giving maintainers confidence to merge without investigating pre-existing breakage.

## Requirement Verification

### CIFR-01: Fetch CI check results via Checks API
**Status: PASSED**
- `src/handlers/ci-failure.ts` uses `octokit.rest.checks.listForRef` with `ref: headSha` and `filter: "latest"`
- Paginated via `octokit.paginate.iterator` to handle repos with many check runs
- 403 errors caught and logged as potential `checks:read` permission issue

### CIFR-02: Compare against base branch to identify pre-existing failures
**Status: PASSED**
- Handler fetches last 3 commits on `pr.base.ref` via `repos.listCommits`
- Fetches check runs for each base commit (sequential to reduce API burst)
- `classifyFailures` compares head failures against base results by exact check name match
- When no base-branch data exists, CI annotation is skipped entirely (no guessing)

### CIFR-03: Post annotation comment with reasoning
**Status: PASSED**
- `formatCISection` produces markdown with:
  - Summary line: "N of M failures appear unrelated to this PR"
  - Expandable `<details>` with per-check classification, confidence level, and evidence
  - Icon mapping: checkmark (unrelated), warning (flaky), x (pr-related)
- Comment upserted via marker-based idempotency (`<!-- kodiai:ci-analysis:owner/repo/pr-N -->`)
- No comment posted when all checks pass

### CIFR-04: Does not block approval or lower merge confidence
**Status: PASSED**
- `src/handlers/ci-failure.ts` has zero imports from `merge-confidence.ts`
- Handler registered independently on `check_suite.completed`
- No modifications to review handler, mention handler, or any existing handler
- CI analysis is purely informational annotation

### CIFR-05: Track flaky workflows using history
**Status: PASSED**
- `ci_check_history` table (migration 008) stores all check run conclusions
- `recordCheckRuns` called on every `check_suite.completed` event for organic data accumulation
- `getFlakiness` computes rolling window of last 20 runs per check name
- Classifier uses >30% failure rate over 20+ runs as flaky threshold
- Cold start accepted: no flakiness signal until data accumulates

## Must-Have Verification

| Must-Have | Status |
|-----------|--------|
| CI check history table with repo, check_name, head_sha, conclusion and composite index | PASSED |
| Flakiness query returns rolling-window stats (last 20 runs per check per repo) | PASSED |
| Classifier labels "unrelated" (high) when same check fails on base | PASSED |
| Classifier labels "flaky-unrelated" (medium) when flakiness > 30% over 20 runs | PASSED |
| Classifier labels "possibly-pr-related" (low) as default | PASSED |
| Classifier returns empty array when all checks pass | PASSED |
| Handler posts/updates CI analysis comment on PR with failures | PASSED |
| Summary line + expandable per-check details | PASSED |
| No CI comment when all checks pass | PASSED |
| Skips annotation when no base-branch data exists | PASSED |
| Handler independent of review pipeline | PASSED |
| Check runs recorded for flakiness tracking | PASSED |
| Idempotent re-runs produce updated comment | PASSED |

## Test Results

- `bun test src/lib/ci-failure-classifier.test.ts`: 9/9 tests pass
- `bun build src/index.ts --no-bundle`: builds without errors
- `bun build src/handlers/ci-failure.ts --no-bundle`: builds without errors

## Artifacts Created

| File | Purpose |
|------|---------|
| `src/db/migrations/008-ci-check-history.sql` | Table DDL |
| `src/db/migrations/008-ci-check-history.down.sql` | Rollback DDL |
| `src/lib/ci-check-store.ts` | Data access layer |
| `src/lib/ci-failure-classifier.ts` | Classification engine |
| `src/lib/ci-failure-classifier.test.ts` | Unit tests |
| `src/lib/ci-failure-formatter.ts` | Markdown formatter |
| `src/handlers/ci-failure.ts` | Webhook handler |
| `src/index.ts` (modified) | Handler registration |

## Score

**5/5 requirements verified. All must-haves pass.**
