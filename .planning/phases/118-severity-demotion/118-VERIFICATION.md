---
phase: 118-severity-demotion
status: passed
verified: 2026-03-03
---

# Phase 118: Severity Demotion - Verification

## Phase Goal
Findings with unverified external knowledge claims cannot retain high severity, preventing hallucinated CRITICALs from bypassing suppression.

## Must-Haves Verification

### Truths

| Truth | Status | Evidence |
|-------|--------|----------|
| primarily-external CRITICAL demoted to medium | PASSED | Unit test: "demotes CRITICAL + primarily-external to medium" |
| primarily-external MAJOR demoted to medium | PASSED | Unit test: "demotes MAJOR + primarily-external to medium" |
| primarily-diff-grounded CRITICAL keeps severity | PASSED | Unit test: "does NOT demote CRITICAL + primarily-diff-grounded" |
| mixed findings keep original severity | PASSED | Unit test: "does NOT demote CRITICAL + mixed" |
| Missing classification = fail-open | PASSED | Unit tests: undefined and null summaryLabel cases |
| Demoted findings carry preDemotionSeverity | PASSED | Unit test checks preDemotionSeverity field |
| Every demotion logged with required fields | PASSED | Unit test: logger mock verifies findingTitle, originalSeverity, newSeverity, summaryLabel |
| isFeedbackSuppressionProtected sees medium | PASSED | Demotion applied before processedFindings; safety-guard sees severity="medium" |

### Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| src/lib/severity-demoter.ts | EXISTS | Exports demoteExternalClaimSeverities |
| src/lib/severity-demoter.test.ts | EXISTS | 14 passing tests |

### Key Links

| Link | Status | Evidence |
|------|--------|----------|
| review.ts -> severity-demoter.ts | WIRED | Import at line 20, called at line 2990 |
| severity-demoter.ts -> claim-classifier.ts types | WIRED | Imports FindingClaimClassification |

## Requirement Coverage

| Requirement | Status | How |
|-------------|--------|-----|
| SEV-01 | COMPLETE | demoteExternalClaimSeverities caps CRITICAL/MAJOR primarily-external at medium |
| SEV-02 | COMPLETE | Demotion mutates severity before processedFindings; isFeedbackSuppressionProtected sees "medium" |
| SEV-03 | COMPLETE | Structured pino log at info level per demotion with findingTitle, originalSeverity, newSeverity, reason, summaryLabel |

## Test Results

```
bun test src/lib/severity-demoter.test.ts src/feedback/safety-guard.test.ts
27 pass, 0 fail, 52 expect() calls
```

## Overall: PASSED

All success criteria met. No gaps found.
