---
id: T01
parent: S01
milestone: M038
key_files:
  - src/structural-impact/types.ts
  - src/structural-impact/adapters.ts
  - src/structural-impact/adapters.test.ts
key_decisions:
  - Adapter contracts are typed locally (GraphBlastRadiusResult, CorpusCodeMatch) and do NOT import from review-graph/ or knowledge/ — substrate changes stay bounded to the concrete wiring in orchestrator.ts
  - StructuralImpactStatus three-way enum (ok/partial/unavailable) lets callers distinguish full data, degraded partial, and complete absence without boolean field combinations
  - probableDependents from M040 blast-radius are surfaced as probableCallers in the consumer payload — clearer semantics for review prompt authors
  - graphStats.changedFilesRequested is added at the assembly boundary (not present in raw M040 result) to give prompt formatters a denominator for coverage framing
duration: 
verification_result: passed
completed_at: 2026-04-05T16:57:03.594Z
blocker_discovered: false
---

# T01: Defined StructuralImpactPayload, GraphAdapter, CorpusAdapter contracts and boundStructuralImpactPayload assembly in src/structural-impact/ with 18 passing tests and clean tsc

**Defined StructuralImpactPayload, GraphAdapter, CorpusAdapter contracts and boundStructuralImpactPayload assembly in src/structural-impact/ with 18 passing tests and clean tsc**

## What Happened

Created the src/structural-impact/ module with three files. types.ts defines the bounded consumer payload types: StructuralImpactPayload (top-level hand-off), StructuralCaller, StructuralImpactFile, StructuralLikelyTest, CanonicalCodeEvidence, StructuralGraphStats, StructuralImpactStatus (ok/partial/unavailable), and StructuralImpactDegradation. adapters.ts defines GraphAdapter and CorpusAdapter interfaces as explicit dependency seams typed locally — no imports from review-graph/ or knowledge/ — and exports boundStructuralImpactPayload, the single assembly function that merges a nullable graph result and corpus matches into a StructuralImpactPayload. adapters.test.ts has 18 in-process stub tests covering all three status codes, degradation paths, field translation fidelity, and adapter interface shape. One naming deviation: M040's probableDependents is surfaced as probableCallers in the consumer payload for clarity to review prompt authors.

## Verification

Ran both task-plan verification commands: bun test ./src/structural-impact/adapters.test.ts → 18 pass, 0 fail (9ms); bun run tsc --noEmit → clean (no output).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/structural-impact/adapters.test.ts` | 0 | ✅ pass | 9ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 800ms |

## Deviations

M040's probableDependents field is renamed to probableCallers in the consumer payload (StructuralImpactPayload). The raw M040 name is preserved in GraphBlastRadiusResult (the local adapter mirror type). This is a cosmetic consumer-clarity decision, not a structural deviation.

## Known Issues

None.

## Files Created/Modified

- `src/structural-impact/types.ts`
- `src/structural-impact/adapters.ts`
- `src/structural-impact/adapters.test.ts`
