---
phase: 119
status: passed
verified: 2026-03-03
---

# Phase 119: Output Filtering — Verification

## Phase Goal
Findings with external knowledge claims are either cleaned up (claim removed, diff-grounded core preserved) or suppressed entirely before the bot publishes.

## Success Criteria Verification

### 1. Mixed findings rewritten to remove external claims
**Status:** PASSED

- `filterExternalClaims` in `src/lib/output-filter.ts` handles `summaryLabel === "mixed"` findings
- Keeps sentences with `label !== "external-knowledge"` (diff-grounded + inferential)
- Appends footnote: "ℹ️ Some claims removed (unverifiable)"
- Unit tests verify rewriting preserves diff-grounded and inferential sentences
- Integration in review.ts updates `finding.title` with rewritten text before publishing

### 2. Primarily-external findings suppressed entirely
**Status:** PASSED

- `filterExternalClaims` excludes `summaryLabel === "primarily-external"` findings from output
- Integration sets `suppressed: true` on matching processedFindings
- `visibleFindings` filter at ~line 3140 naturally excludes suppressed findings
- Suppressed findings listed in collapsed `<details>` section via `formatSuppressedFindingsSection`
- Unit tests verify suppression and section formatting

### 3. Suppressed/rewritten findings logged for observability
**Status:** PASSED

- `FilteredFindingRecord` captures: commentId, originalTitle, action, rewrittenTitle, reason, classificationEvidence
- Logger.info called for each filtered finding with structured data
- Integration logs aggregate summary with rewriteCount + suppressionCount + per-finding details
- Learning memory naturally records suppressed findings (outcome='suppressed') via existing pipeline

## Requirement Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| FILT-01 | Complete | Mixed findings rewritten: external sentences removed, diff-grounded core preserved, footnote appended |
| FILT-02 | Complete | Primarily-external findings suppressed from output, shown in collapsed review summary section |
| FILT-03 | Complete | Structured pino logs per finding, aggregate filter summary, learning memory negative signal |

## Automated Verification

```
bun test src/lib/output-filter.test.ts — 15 pass, 0 fail
bun test src/lib/claim-classifier.test.ts — 30 pass, 0 fail
bun test src/lib/severity-demoter.test.ts — 16 pass, 0 fail
bun build src/handlers/review.ts --no-bundle — compiles successfully
```

## Must-Haves Check

| Truth | Verified |
|-------|----------|
| Mixed finding rewritten: external sentences removed, diff-grounded + inferential kept | Yes — test + code |
| Primarily-external finding suppressed entirely | Yes — test + code |
| Rewritten stubs below threshold suppressed | Yes — test (10-word minimum) |
| Rewritten findings have footnote | Yes — test confirms footnote present |
| Suppressed findings in collapsed details section | Yes — formatSuppressedFindingsSection test |
| Suppressed findings feed learning memory as negative signal | Yes — suppressed=true flows to existing learning memory writer |
| Structured log per suppressed/rewritten finding | Yes — logger.info in filterExternalClaims + review.ts aggregate |
| suppression_count and rewrite_count logged | Yes — pino log in review.ts |
| Fail-open on missing classification | Yes — test confirms passthrough |
| Fail-open on error | Yes — undefined/empty classification passes through |

## Conclusion

All success criteria met. All requirements (FILT-01, FILT-02, FILT-03) satisfied. Phase 119 complete.
