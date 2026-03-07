---
phase: 126-global-anti-hallucination-guardrails
plan: 05
subsystem: guardrails
tags: [guardrail, audit-store, postgres, pipeline, review, anti-hallucination]

# Dependency graph
requires:
  - phase: 126-global-anti-hallucination-guardrails (plans 01-04)
    provides: guardrail pipeline, audit store, surface adapters, handler wiring
provides:
  - auditStore wired to all 5 handler runGuardrailPipeline calls for GUARD-06
  - review guardrail pipeline authoritative mode (exit shadow) for GUARD-01
affects: [126-verification, guardrail-monitoring, review-output-quality]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "createGuardrailAuditStore(sql) created once at handler init, passed to all pipeline calls"
    - "guardrail-suppressed/guardrail-rewritten filterAction values for review finding tracking"

key-files:
  created: []
  modified:
    - src/handlers/review.ts
    - src/handlers/mention.ts
    - src/slack/assistant-handler.ts
    - src/handlers/troubleshooting-agent.ts
    - src/knowledge/wiki-update-generator.ts
    - src/index.ts

key-decisions:
  - "AuditStore created once per handler init (not per-request) since it is stateless, just holds sql reference"
  - "Review guardrail output applied via map over processedFindings, marking removed findings as suppressed rather than removing them from array (preserves count/logging)"
  - "filterAction type extended with guardrail-suppressed and guardrail-rewritten to distinguish guardrail actions from existing output-filter actions"

patterns-established:
  - "Guardrail audit store wiring: import createGuardrailAuditStore, create once at init, pass to every runGuardrailPipeline call"
  - "Authoritative guardrail mode: match findings by commentId between guardResult.output and processedFindings"

requirements-completed: [GUARD-01, GUARD-06]

# Metrics
duration: 7min
completed: 2026-03-07
---

# Phase 126 Plan 05: Audit Store Wiring and Review Authoritative Mode Summary

**Wire auditStore into all 5 handler guardrail pipeline calls for Postgres audit logging, and exit review shadow mode so guardrail pipeline controls final output**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-07T15:01:12Z
- **Completed:** 2026-03-07T15:08:39Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- All 5 handlers (review, mention, slack, troubleshooting, wiki) now pass auditStore to runGuardrailPipeline, unblocking GUARD-06 audit data collection
- Review guardrail pipeline exits shadow mode: guardResult.output replaces processedFindings when non-null, with defense-in-depth fallback on error
- Three handlers (review, mention, slack) now accept sql as optional dep, wired from index.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire auditStore into all 5 handler guardrail pipeline calls** - `1f9816ee8a` (feat)
2. **Task 2: Make review guardrail pipeline authoritative (exit shadow mode)** - `51fddf6ca9` (feat)

## Files Created/Modified
- `src/handlers/review.ts` - Added sql dep, auditStore wiring, authoritative guardrail output application
- `src/handlers/mention.ts` - Added sql dep and auditStore wiring to guardrail pipeline call
- `src/slack/assistant-handler.ts` - Added sql dep and auditStore wiring to both guardrail pipeline calls
- `src/handlers/troubleshooting-agent.ts` - Added auditStore wiring (already had sql dep)
- `src/knowledge/wiki-update-generator.ts` - Added auditStore wiring (already had sql via opts)
- `src/index.ts` - Pass sql to createReviewHandler, createMentionHandler, createSlackAssistantHandler

## Decisions Made
- AuditStore created once per handler init (not per-request) since it is stateless -- just holds the sql reference
- Review guardrail output applied via map over processedFindings, marking removed findings as suppressed rather than removing from array (preserves count/logging)
- filterAction type extended with guardrail-suppressed and guardrail-rewritten to distinguish from existing output-filter actions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GUARD-06 (audit logging) is now fully wired -- guardrail_audit table will receive records for every pipeline run
- GUARD-01 (review anti-hallucination) is fully authoritative -- guardrail pipeline controls final review output
- All handlers have consistent auditStore wiring pattern
- Pre-existing test failure in comment-server.test.ts (severity assertion) is unrelated to these changes

---
*Phase: 126-global-anti-hallucination-guardrails*
*Completed: 2026-03-07*

## Self-Check: PASSED
