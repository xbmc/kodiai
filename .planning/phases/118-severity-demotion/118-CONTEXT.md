# Phase 118: Severity Demotion - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Findings with unverified external knowledge claims cannot retain high severity. CRITICAL and MAJOR findings classified as `primarily-external` get capped at medium, preventing hallucinated CRITICALs from bypassing suppression. This phase does NOT rewrite or filter finding content (that's Phase 119).

</domain>

<decisions>
## Implementation Decisions

### Demotion Thresholds
- Only `primarily-external` summary label triggers demotion — `mixed` and `primarily-diff-grounded` findings keep original severity
- Cap level is medium: CRITICAL -> medium, MAJOR -> medium
- Findings already at medium or minor are not affected
- Fail-open: if claim classification data is missing or errored, finding keeps original severity (consistent with claim-classifier's existing fail-open design)

### Suppression Protection Override
- Demotion happens upstream of `isFeedbackSuppressionProtected` — mutate severity before the check so safety-guard naturally sees 'medium'
- `isFeedbackSuppressionProtected` in safety-guard.ts stays untouched — it just sees the demoted severity
- MAJOR security/correctness findings get the same treatment — if primarily-external, they lose protection when demoted to medium
- Add `originalSeverity` field to finding object for logging/audit (finding.originalSeverity = 'critical', finding.severity = 'medium')

### Demotion Logging
- Structured pino log entry at `info` level per demoted finding
- Log fields: findingTitle, originalSeverity, newSeverity, reason, summaryLabel
- Reason includes specific claim evidence strings from the classifier (not just summary label)
- Demotion is internal only — NOT mentioned in PR summary comments posted to GitHub

### Pipeline Placement
- Demotion runs after claim classification, before feedback suppression
- Natural insertion point: right after `classifyClaims` results are mapped, before `processedFindings` construction
- New dedicated module: `src/lib/severity-demoter.ts` — single responsibility (claim-classifier classifies, severity-demoter acts on classifications)
- Returns new objects with severity overwritten and originalSeverity added (immutable pattern, consistent with classifyClaims)
- Always on — no config toggle. This is a correctness fix, not an optional feature

### Claude's Discretion
- Internal type definitions for the demoter module
- Test structure and edge case coverage
- Exact integration wiring in review.ts

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The decisions above are precise enough to implement directly.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `claim-classifier.ts`: Already produces `FindingClaimClassification` with `summaryLabel` and per-claim `ClaimClassification[]` including evidence strings
- `ClaimClassifiedFinding` type: Finding annotated with claim classification results — input to the demoter
- `FindingSeverity` type from `knowledge/types.ts`: `"critical" | "major" | "medium" | "minor"`

### Established Patterns
- Fail-open: claim-classifier returns default `primarily-diff-grounded` on errors — demoter should follow same pattern
- Immutable transforms: `classifyClaims()` returns new objects via spread, demoter should do the same
- Structured logging: `logger.info({ ...baseLog, field1, field2 }, "Message")` pattern throughout review.ts
- `claimClassificationMap`: already built as `Map<commentId, FindingClaimClassification>` in review.ts (~line 2969)

### Integration Points
- review.ts ~line 2968: After `classifyClaims()` and `claimClassificationMap` construction — insert demotion step here
- review.ts ~line 3045: `processedFindings` construction — needs to use demoted severity and carry `originalSeverity`
- `ProcessedFinding` type (~line 118): Needs `originalSeverity?: FindingSeverity` field added
- `isFeedbackSuppressionProtected` call (~line 60 of feedback/index.ts): Will naturally see demoted severity, no changes needed

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 118-severity-demotion*
*Context gathered: 2026-03-02*
