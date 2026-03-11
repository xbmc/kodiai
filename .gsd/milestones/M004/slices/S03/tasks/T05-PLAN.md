# T05: 28-knowledge-store-explicit-learning 07

**Slice:** S03 — **Milestone:** M004

## Description

Close unresolved Phase 28 verification gaps by wiring runtime finding extraction, deterministic suppression/confidence behavior, and enforced quantitative review-details output.

Purpose: Phase 28 infrastructure exists, but LEARN-01..LEARN-04 remain blocked because runtime currently uses placeholder findings and model-only formatting compliance. This plan completes the runtime loop so learning behavior is deterministic and persistently queryable.

Output: Review-handler extraction/filtering/persistence pipeline plus tests that lock suppression, minConfidence soft filtering, and required Review Details metrics/time-saved output.

## Must-Haves

- [ ] "Runtime extracts real findings from review execution and persists finding/suppression history per repo"
- [ ] "Configured suppressions are applied deterministically to emitted findings, not only prompt instructions"
- [ ] "minConfidence uses a soft filter: below-threshold findings move to a separate Low Confidence Findings section"
- [ ] "Published review output always includes a collapsible Review Details section with files, lines, severity counts, and estimated time saved"

## Files

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
