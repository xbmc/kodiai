# T01: 119-output-filtering 01

**Slice:** S05 — **Milestone:** M024

## Description

Implement output filtering for findings with external knowledge claims before publishing.

Purpose: This is the final gate in the epistemic pipeline. Claim-classifier (Phase 117) labeled claims, severity-demoter (Phase 118) capped severity, and now this filter either rewrites mixed findings (removing external-knowledge sentences while preserving the diff-grounded core) or suppresses primarily-external findings entirely. Suppressed findings appear in a collapsed section of the review summary for transparency.

Output: `src/lib/output-filter.ts` module + tests + integration in review.ts pipeline

## Must-Haves

- [ ] "A mixed finding (has both diff-grounded and external-knowledge claims) is rewritten: external-knowledge sentences removed, diff-grounded and inferential sentences kept verbatim"
- [ ] "A primarily-external finding (no diff-grounded core) is suppressed entirely and never published as an inline comment"
- [ ] "Rewritten findings that shrink below the minimum word threshold are suppressed instead of published as stubs"
- [ ] "Rewritten findings have a footnote appended: 'Some claims removed (unverifiable)'"
- [ ] "Suppressed findings are collected for the collapsed details section in the review summary"
- [ ] "Suppressed findings feed into learning memory as negative signal (outcome='suppressed')"
- [ ] "Structured log for every suppressed/rewritten finding: original text, action, rewritten text (if applicable), classification evidence"
- [ ] "suppression_count and rewrite_count are logged in telemetry per review"
- [ ] "Findings with no claim classification pass through unchanged (fail-open)"
- [ ] "On any error, findings pass through unchanged (fail-open)"

## Files

- `src/lib/output-filter.ts`
- `src/lib/output-filter.test.ts`
- `src/handlers/review.ts`
