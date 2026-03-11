# T02: 51-timeout-resilience 02

**Slice:** S01 — **Milestone:** M009

## Description

Integrate timeout estimation into the review handler for scope reduction and informative timeout messages.

Purpose: TMO-02 (auto-reduce scope for high-risk PRs) and TMO-03 (informative timeout messages instead of generic errors). This completes all four timeout resilience requirements.

Output: Review handler that estimates timeout risk before execution, reduces scope when appropriate, and posts informative messages on timeout with partial review context.

## Must-Haves

- [ ] "Before executing a review, the handler estimates timeout risk and logs the assessment"
- [ ] "High-risk PRs with auto-selected profile get scope reduced to minimal profile and capped file count"
- [ ] "High-risk PRs with user-explicit profile are NOT scope-reduced (user choice respected)"
- [ ] "When a timeout occurs and inline comments were published, the user sees a partial-review message (not an error)"
- [ ] "When a timeout occurs and nothing was published, the user sees an informative error with PR complexity context"
- [ ] "Telemetry conclusion distinguishes timeout_partial from timeout"

## Files

- `src/handlers/review.ts`
- `src/lib/errors.ts`
