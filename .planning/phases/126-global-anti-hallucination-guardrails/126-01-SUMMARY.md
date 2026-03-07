---
phase: 126-global-anti-hallucination-guardrails
plan: 01
subsystem: guardrail
tags: [anti-hallucination, claim-classification, context-grounding, allowlist, audit, pipeline]

requires:
  - phase: claim-classifier
    provides: ClaimLabel, ClaimClassification, DiffContext types and classifyClaimHeuristic function
provides:
  - Unified guardrail pipeline (runGuardrailPipeline) accepting any SurfaceAdapter
  - Context-grounded claim classifier for non-diff surfaces
  - General programming knowledge allowlist (8 categories)
  - Guardrail audit store with Postgres migration
  - GuardrailConfig with strictness levels in .kodiai.yml schema
affects: [126-02-llm-fallback, 126-03-surface-adapters, pr-review, issue-triage, mention]

tech-stack:
  added: []
  patterns: [surface-adapter-pattern, classify-filter-audit-pipeline, fail-open-default, fire-and-forget-audit]

key-files:
  created:
    - src/lib/guardrail/types.ts
    - src/lib/guardrail/allowlist.ts
    - src/lib/guardrail/context-classifier.ts
    - src/lib/guardrail/pipeline.ts
    - src/lib/guardrail/audit-store.ts
    - src/db/migrations/026-guardrail-audit.sql
  modified:
    - src/execution/config.ts

key-decisions:
  - "Allowlist uses substring matching on lowercase claim text for simplicity and performance"
  - "Context classifier checks allowlist first, then external-knowledge patterns, then diff delegation, then word overlap"
  - "Overlap thresholds: strict=0.3, standard=0.5, lenient=0.7 — lower threshold means easier to ground (stricter filtering)"
  - "Pipeline is async to support future LLM fallback but classification step is synchronous"
  - "Fire-and-forget audit logging via void + .catch() pattern consistent with citation logging (121-01)"

patterns-established:
  - "SurfaceAdapter<TInput, TOutput> pattern: each surface provides extractClaims, buildGroundingContext, reconstructOutput"
  - "Classify-filter-audit pipeline: extract -> classify -> filter external-knowledge -> threshold check -> reconstruct -> audit"
  - "Fail-open on classifier errors: output unchanged, classifierError flag set"
  - "StrictnessLevel config with surface-specific overrides"

requirements-completed: [GUARD-01, GUARD-02, GUARD-03, GUARD-06]

duration: 8min
completed: 2026-03-07
---

# Phase 126 Plan 01: Core Guardrail Pipeline Foundation Summary

**Unified classify-filter-audit pipeline with context-grounded classifier, programming knowledge allowlist, Postgres audit store, and configurable strictness levels**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-07T09:06:24Z
- **Completed:** 2026-03-07T09:14:00Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Built complete `src/lib/guardrail/` module with types, classifier, allowlist, pipeline, and audit store
- Context-grounded classifier generalizes claim-classifier.ts patterns to arbitrary text context (issues, wiki, conversation)
- General programming knowledge allowlist with 8 categories prevents false positives on common coding concepts
- Unified pipeline accepts any SurfaceAdapter and classifies+filters+audits claims with fail-open behavior
- Guardrail audit table with migration for tracking all pipeline runs in Postgres
- Config schema extended with guardrails.strictness supporting strict/standard/lenient levels

## Task Commits

Each task was committed atomically:

1. **Task 1: Create types, context classifier, and allowlist** - `727e1cf449` (feat)
2. **Task 2: Create audit store, migration, and config schema** - `304373df47` (feat)
3. **Task 3: Create unified guardrail pipeline** - `4a1fff9b0e` (feat)

_Note: TDD tasks have RED+GREEN in single commits (tests + implementation together)_

## Files Created/Modified
- `src/lib/guardrail/types.ts` - GroundingContext, SurfaceAdapter, GuardrailConfig, AuditRecord, GuardrailResult types
- `src/lib/guardrail/allowlist.ts` - General programming knowledge allowlist with 8 categories
- `src/lib/guardrail/context-classifier.ts` - Context-grounded claim classifier with strictness-aware thresholds
- `src/lib/guardrail/pipeline.ts` - Unified classify-filter-audit pipeline
- `src/lib/guardrail/audit-store.ts` - Fire-and-forget Postgres audit logging
- `src/db/migrations/026-guardrail-audit.sql` - guardrail_audit table with indexes
- `src/execution/config.ts` - Added guardrails.strictness config with section-fallback parsing

## Decisions Made
- Allowlist uses substring matching on lowercase claim text for simplicity and performance
- Context classifier checks allowlist first, then external-knowledge patterns, then diff delegation, then word overlap
- Overlap thresholds: strict=0.3, standard=0.5, lenient=0.7 — lower threshold means easier to ground (stricter filtering)
- Pipeline is async to support future LLM fallback but classification step is synchronous
- Fire-and-forget audit logging via void + .catch() pattern consistent with citation logging (121-01)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pipeline foundation complete, ready for LLM fallback (plan 02) and surface adapters (plan 03+)
- All existing tests continue to pass (claim-classifier.ts and output-filter.ts unchanged)
- Config schema ready for guardrails.strictness in .kodiai.yml

---
*Phase: 126-global-anti-hallucination-guardrails*
*Completed: 2026-03-07*
