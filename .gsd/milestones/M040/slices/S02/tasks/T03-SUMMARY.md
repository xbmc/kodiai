---
id: T03
parent: S02
milestone: M040
key_files:
  - scripts/verify-m040-s02.ts
  - scripts/verify-m040-s02.test.ts
  - package.json
key_decisions:
  - Used TOP_N=1 for the MISSED-FILES check to prove rank promotion rather than mere presence in a wider top-K set.
  - All four checks use synchronous in-memory fixtures with no DB or network, keeping the harness fast and hermetic.
duration: 
verification_result: passed
completed_at: 2026-04-05T12:06:58.472Z
blocker_discovered: false
---

# T03: Added scripts/verify-m040-s02.ts and test file — four machine-checkable checks proving graph-aware selection surfaces impacted files, promotes likely tests, and reranks dependents beyond file-risk triage alone

**Added scripts/verify-m040-s02.ts and test file — four machine-checkable checks proving graph-aware selection surfaces impacted files, promotes likely tests, and reranks dependents beyond file-risk triage alone**

## What Happened

Built a fixture-based proof harness following the established M037/M036 verify-script pattern. The harness exercises four named checks directly against the real queryBlastRadiusFromSnapshot and applyGraphAwareSelection implementations with no DB or network. GRAPH-SURFACES-MISSED-FILES builds a C++ graph where StringUtils.h is changed with VideoPlayer.cpp having include/callsite edges to it; graph-aware selection places VideoPlayer at #1 while risk-only places the auth-path OAuth2Handler at #1 — TOP_N=1 cleanly proves the impacted file would miss the top slot without graph signals. GRAPH-SURFACES-LIKELY-TESTS builds a Python graph with a tests edge from test_string_utils.py to format_string; graph-aware selection promotes the test file into top-2 while risk-only scoring ranks it below the high-lines source file. GRAPH-RERANKS-DEPENDENTS builds a C++ graph with a direct calls edge from FileCurl::Open to URIUtils::GetExtension; graph-aware selection promotes FileCurl.cpp above PVRManager.cpp which has slightly more lines but no graph signal; probable dependents list contains the caller. FALLBACK-PRESERVES-ORDER passes graph=null through applyGraphAwareSelection and asserts the fail-open contract: usedGraph=false, graphHits=0, risk ordering byte-identical. Each check has 2-3 negative injection tests. Added verify:m040:s02 script to package.json. A TOP_N=1 adaptation was needed for MISSED-FILES because with TOP_N=2 the impacted file was already in risk-only top-2 at rank 2, leaving graphSurfacedExtra empty.

## Verification

Ran bun test ./scripts/verify-m040-s02.test.ts (24/24 pass, 0 fail), bun run verify:m040:s02 -- --json (exits 0, overallPassed: true, all four checks PASS with machine-readable detail), and bun run tsc --noEmit (no type errors).

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m040-s02.test.ts` | 0 | ✅ pass | 34ms |
| 2 | `bun run verify:m040:s02 -- --json` | 0 | ✅ pass | 200ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 7000ms |

## Deviations

Used TOP_N=1 for the MISSED-FILES fixture (plan did not specify a TOP_N). TOP_N=2 left graphSurfacedExtra empty because the impacted file was already present in risk-only top-2 at rank 2, which would have caused the check to wrongly fail. TOP_N=1 precisely captures the rank-promotion claim.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m040-s02.ts`
- `scripts/verify-m040-s02.test.ts`
- `package.json`
