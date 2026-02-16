---
phase: 59-resilience-layer
verified: 2026-02-16T00:15:24.057Z
status: gaps_found
score: 3/5 must-haves verified
gaps:
  - truth: "When a review times out with no published output, Kodiai retries once with the top 50% of files by risk score and a halved timeout budget"
    status: failed
    reason: "Retry enqueue is gated on having partial results (checkpoint findingCount>=1 or inline output). If a review fully times out before any output/checkpoint, the handler posts an error comment and does not enqueue a retry. Also, retry can be enqueued even when inline output was already published."
    artifacts:
      - path: "src/handlers/review.ts"
        issue: "Retry path only runs inside `if (hasPartialResults)`; `hasPartialResults` is false when `result.published` is false and checkpoint has 0 findings."
      - path: "src/lib/retry-scope-reducer.ts"
        issue: "Scope computation exists, but is not reached for the full-timeout/no-output case."
    missing:
      - "Enqueue retry (once) on `timeout` when `result.published` is false (even if no checkpoint exists), using riskScores to select top 50% and halved timeout."
      - "Align retry eligibility with stated goal (no published output) to avoid unnecessary retries after inline output exists."
  - truth: "Checkpoint data and retry metadata are visible in telemetry for operational monitoring"
    status: partial
    reason: "Telemetry captures pr_author, event_type (including retry), and conclusion (timeout vs timeout_partial), but does not capture checkpoint/retry metadata (e.g., filesReviewed, findingCount, retry scopeRatio/selectedFilesCount, retryTimeoutSeconds)."
    artifacts:
      - path: "src/telemetry/types.ts"
        issue: "TelemetryRecord has no fields for checkpoint/retry metadata."
      - path: "src/handlers/review.ts"
        issue: "Retry metadata is logged, but not recorded in telemetry store records."
    missing:
      - "Add structured telemetry fields (or a side-table) for checkpoint/retry metadata, and populate them for both initial run and retry."
human_verification:
  - test: "Timeout with checkpoint -> partial comment published"
    expected: "On forced timeout, a top-level partial review comment is created with the disclaimer header and the checkpoint summaryDraft body."
    why_human: "Requires real GitHub execution and an induced timeout; cannot be proven from static analysis/tests."
  - test: "Timeout with no checkpoint/no output -> retry behavior"
    expected: "A retry is enqueued exactly once (or at minimum meets roadmap requirement), using top 50% by risk and half timeout budget."
    why_human: "Depends on runtime timeout behavior and checkpoint frequency; code currently appears not to retry in this case."
  - test: "Retry replaces partial comment"
    expected: "Retry completion edits (updates) the original partial review comment body (merged view), not a new comment."
    why_human: "Requires end-to-end GitHub comment creation + updateComment call in a live run."
---

# Phase 59: Resilience Layer Verification Report

**Phase Goal (ROADMAP.md):** Kodiai recovers value from timed-out reviews by publishing accumulated partial results and optionally retrying with a reduced file scope.
**Verified:** 2026-02-16T00:15:24.057Z
**Status:** gaps_found

## What I Verified

### Observable Truths (Goal-Backward)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | During review execution, Kodiai can accumulate partial review state and publish a partial review comment on timeout | ✓ VERIFIED | Checkpoint tool persists to knowledge store (`src/execution/mcp/checkpoint-server.ts:19`); timeout path reads checkpoint and posts partial review comment (`src/handlers/review.ts:2748`, `src/handlers/review.ts:2774`) |
| 2 | When a review times out with no published output, Kodiai retries once with top 50% by risk and half timeout | ✗ FAILED | Retry enqueue occurs only if `hasPartialResults` is true (`src/handlers/review.ts:2752`, `src/handlers/review.ts:2801`); no retry path exists for `timeout` with no output/checkpoint |
| 3 | Retry is capped at exactly 1 attempt | ✓ VERIFIED | Only `-retry-1` keys/branches appear; no `retry-2` (`src/handlers/review.ts:2803`, `src/handlers/review.ts:2858`) |
| 4 | Repos with 3+ recent timeouts skip retry | ✓ VERIFIED | Chronic check via telemetry count (`src/handlers/review.ts:2756`), gate `isChronicTimeout >= 3` (`src/handlers/review.ts:2760`), no enqueue when chronic (`src/handlers/review.ts:2802`) |
| 5 | Checkpoint + retry metadata visible in telemetry | ⚠️ PARTIAL | Telemetry records `prAuthor` + eventType + conclusion (`src/handlers/review.ts:2441`, `src/telemetry/store.ts:155`), but no structured checkpoint/retry metadata fields |

**Score:** 3/5 truths verified

## Required Artifacts (Existence + Substantive + Wired)

| Artifact | Expected | Status | Details |
|---------|----------|--------|---------|
| `src/execution/mcp/checkpoint-server.ts` | MCP tool `save_review_checkpoint` persists checkpoint | ✓ VERIFIED | Saves via `knowledgeStore.saveCheckpoint()` (`src/execution/mcp/checkpoint-server.ts:54`) |
| `src/knowledge/store.ts` | `review_checkpoints` table + checkpoint CRUD, upsert | ✓ VERIFIED | Table created (`src/knowledge/store.ts:368`); upsert uses `ON CONFLICT` (`src/knowledge/store.ts:514`); methods implemented (`src/knowledge/store.ts:1124`) |
| `src/lib/partial-review-formatter.ts` | Partial review disclaimer formatting | ✓ VERIFIED | `formatPartialReviewComment()` with standard + retry-result + retry-skipped paths (`src/lib/partial-review-formatter.ts:12`) |
| `src/lib/retry-scope-reducer.ts` | Retry scope reduction, excludes reviewed, adaptive ratio | ✓ VERIFIED | `computeRetryScope()` filters + sorts + computes ratio (`src/lib/retry-scope-reducer.ts:14`) |
| `src/telemetry/store.ts` | Chronic timeout counting by repo+author (7d) | ✓ VERIFIED | `countRecentTimeouts()` query (`src/telemetry/store.ts:179`) |
| `src/execution/mcp/index.ts` | Checkpoint tool wired into MCP builder conditionally | ✓ VERIFIED | `enableCheckpointTool` gating + server creation (`src/execution/mcp/index.ts:81`) |
| `src/execution/review-prompt.ts` | Prompt tells model to call checkpoint tool when enabled | ✓ VERIFIED | `checkpointEnabled` guard + instructions (`src/execution/review-prompt.ts:1303`) |

## Key Link Verification (Wiring)

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/execution/mcp/index.ts` | `src/execution/mcp/checkpoint-server.ts` | `createCheckpointServer()` | ✓ WIRED | Imported + conditionally constructed (`src/execution/mcp/index.ts:8`, `src/execution/mcp/index.ts:88`) |
| `src/handlers/review.ts` | `src/knowledge/store.ts` | `knowledgeStore.getCheckpoint()` | ✓ WIRED | Reads checkpoint on timeout (`src/handlers/review.ts:2750`) |
| `src/handlers/review.ts` | `src/telemetry/store.ts` | `telemetryStore.countRecentTimeouts()` | ✓ WIRED | Chronic detection (`src/handlers/review.ts:2756`) |
| `src/handlers/review.ts` | `src/lib/partial-review-formatter.ts` | `formatPartialReviewComment()` | ✓ WIRED | Used for partial + merged retry comment bodies (`src/handlers/review.ts:2763`, `src/handlers/review.ts:2958`) |
| `src/handlers/review.ts` | `src/lib/retry-scope-reducer.ts` | `computeRetryScope()` | ✓ WIRED | Retry scope computed from risk scores (`src/handlers/review.ts:2807`) |

## Requirements Coverage (.planning/REQUIREMENTS.md)

| Requirement | Status | Blocking Issue |
|------------|--------|----------------|
| TMO-05 (checkpoint publishing) | ✓ SATISFIED (code-level) | Human verification still needed for real timeout behavior |
| TMO-06 (retry reduced scope, max 1) | ✗ BLOCKED | No retry on full-timeout/no-output with no checkpoint; eligibility mismatch vs roadmap |

## Commands Run (Fast Checks)

| Command | Result |
|--------|--------|
| `node .../gsd-tools.js roadmap get-phase 59` | Loaded phase goal + success criteria |
| `bun test src/execution/mcp/checkpoint-server.test.ts src/lib/partial-review-formatter.test.ts src/lib/retry-scope-reducer.test.ts --timeout 10000` | PASS (14 tests) |
| `bun test src/telemetry/ --timeout 10000` | PASS (12 tests) |
| `bun test src/knowledge/ --timeout 10000` | PASS (42 tests) |
| `bun test src/execution/ --timeout 10000` | PASS (295 tests; note: some tests print warnings but still pass) |
| `bunx tsc --noEmit` | PASS |

## Integration Risks / Missing Pieces

- **Retry trigger mismatch (goal vs implementation):** current code retries only when partial results exist, and may retry even when inline output already exists; this diverges from roadmap success criteria.
- **Operational telemetry gap:** telemetry store does not capture checkpoint/retry scope metadata; monitoring retry effectiveness will rely on logs.
- **Retry comment update robustness:** partial comment id is written to the knowledge store, but the retry flow uses the in-memory `partialCommentId` variable; if retries ever run out-of-process, comment replacement may fail.

---

_Verified: 2026-02-16T00:15:24.057Z_
_Verifier: Claude (gsd-verifier)_
