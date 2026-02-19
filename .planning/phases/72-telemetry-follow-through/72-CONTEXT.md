# Phase 72: Telemetry Follow-Through - Context

**Gathered:** 2026-02-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate live Search cache and rate-limit telemetry behavior in degraded executions, including exactly-once emission expectations and proof that review completion is not blocked by telemetry persistence failures.

</domain>

<decisions>
## Implementation Decisions

### Live verification scenario shape
- Verification must include both surfaces: PR `review_requested` flow and explicit `@kodiai` mention flow.
- Verification must use a fully scripted deterministic scenario with fixed inputs/checkpoints.
- Cache miss + hit coverage must use a three-run sequence: prime (populate), verify hit, then force miss using a changed query.
- Required cadence is once per milestone.

### Exactly-once telemetry rules
- Exactly-once identity is a composite key: `delivery_id` + event type.
- Retry paths must reuse original identity and must not emit a second event.
- Any duplicate emission fails milestone verification.
- Verification must include two layers: DB-level truth assertions and a human-readable operator summary.

### Demurral and reliability tone
- Tone should appear in both user-facing and operator-facing outputs, with stronger emphasis in operator summaries.
- Reliability phrasing must stay subtle (no playful/exaggerated language).
- Demurral language belongs in analysis body, not in final verdict statements.
- Output must never imply certainty without concrete supporting evidence.

### Claude's Discretion
- Exact wording templates for subtle reliability phrasing, as long as the guardrails above are met.
- Presentation format of operator summary artifacts (table vs bullets), as long as evidence remains explicit and testable.

</decisions>

<specifics>
## Specific Ideas

- Keep an understated "existential crisis averted" style signal in spirit, but translated into subtle, professional wording.
- Reference point: xbmc review style where risk was acknowledged, weighed, and clearly resolved with evidence.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 72-telemetry-follow-through*
*Context gathered: 2026-02-17*
