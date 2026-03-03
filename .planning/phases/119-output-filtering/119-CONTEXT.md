# Phase 119: Output Filtering - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Findings with external knowledge claims are either cleaned up (claim removed, diff-grounded core preserved) or suppressed entirely before the bot publishes. This is the final gate in the epistemic pipeline: claim-classifier (Phase 117) labels claims, severity-demoter (Phase 118) caps severity, and this phase filters the actual output.

</domain>

<decisions>
## Implementation Decisions

### Rewriting mixed findings
- Strip sentences labeled `external-knowledge` from mixed findings, keeping `diff-grounded` and `inferential` sentences verbatim
- No LLM smoothing pass — just remove the external sentences and publish the remainder as-is
- Minimum word count threshold: if the remaining text after stripping is too short (implementation determines exact threshold), suppress the entire finding instead of publishing a stub
- Inferential claims are kept — they are logical deductions from visible code and add value
- Add a subtle footnote to rewritten findings: "ℹ️ Some claims removed (unverifiable)" so reviewers know the original was longer

### Suppression of primarily-external findings
- Findings classified as `primarily-external` (no diff-grounded core) are suppressed entirely — never posted as inline comments
- Suppressed findings are listed in a collapsed `<details>` section appended to the main review summary comment
- Each entry shows the finding title + classification reason (e.g., "CVE reference is external knowledge")
- The collapsed section is only rendered when there are suppressed findings — omit entirely on clean reviews with zero suppressions

### Observability and logging
- Structured logs include: original finding text, action taken (suppressed/rewritten), rewritten text (if applicable), and claim classification evidence — full detail for debugging
- Suppressed findings feed into the existing learning memory system as **negative signal** — the system should learn to generate fewer external-knowledge findings over time
- Add `suppression_count` and `rewrite_count` fields to the telemetry record per review for dashboarding

### Claude's Discretion
- Exact minimum word count threshold for stub detection
- Footnote wording and formatting details
- Collapsed section styling and header text
- Log field naming consistent with existing patterns

</decisions>

<specifics>
## Specific Ideas

- The claim-classifier already tags each sentence with `diff-grounded`, `external-knowledge`, or `inferential` labels — the rewriter can operate directly on these sentence-level classifications
- The severity-demoter runs before this filter, so primarily-external findings reaching this stage already have capped severity — suppression is the final action
- The collapsed suppressed-findings section should feel like existing collapsed sections in the review summary (consistent UX)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `claim-classifier.ts`: `extractClaims()` splits finding text into sentences, `classifyClaimHeuristic()` labels each — rewriter can filter by label directly
- `claim-classifier.ts`: `FindingClaimClassification` type with `summaryLabel` and per-claim `ClaimClassification[]` — all data needed for filtering decisions
- `severity-demoter.ts`: Pattern for immutable finding transformation (returns new objects, never mutates) — output filter should follow same pattern
- `feedback/aggregator.ts` + `knowledge/store.ts`: Existing learning memory infrastructure for recording negative signals
- `telemetry/types.ts`: Existing telemetry record structure to extend with filtering metrics

### Established Patterns
- Fail-open principle: claim-classifier and severity-demoter both default to pass-through on errors — output filter must do the same
- Pipeline composition: review.ts chains classifyClaims → demoteExternalClaimSeverities — output filter is the next step in this chain
- Immutable transforms: findings flow through map/filter chains producing new objects at each stage

### Integration Points
- `src/handlers/review.ts` ~line 2990: After `demoteExternalClaimSeverities`, before findings are published — this is where the output filter slots in
- Review summary comment builder: needs to accept optional suppressed-findings section for the collapsed details
- Telemetry recording: needs new fields for suppression/rewrite counts

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 119-output-filtering*
*Context gathered: 2026-03-02*
