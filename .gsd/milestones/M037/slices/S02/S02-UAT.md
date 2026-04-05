# S02: Thematic Finding Scoring and Review Integration — UAT

**Milestone:** M037
**Written:** 2026-04-05T08:07:18.135Z

# S02 UAT: Thematic Finding Scoring and Review Integration

## Preconditions
- Repo is checked out at `/home/keith/src/kodiai`
- `bun` is available
- `bun run tsc --noEmit` exits 0 (no TypeScript errors)
- S01 substrate complete (suggestion-cluster-store.ts, suggestion_cluster_models migration)

---

## Test Suite A: Unit Tests — Scoring Core (suggestion-cluster-scoring.test.ts)

**Precondition:** `src/knowledge/suggestion-cluster-scoring.ts` exists with exported `isModelEligibleForScoring`, `scoreFindingEmbedding`, `scoreFindings`, `SUPPRESSION_THRESHOLD`, `BOOST_THRESHOLD`, `MIN_CENTROID_MEMBERS_FOR_SCORING`

**1. Cold-start guard**
```
bun test ./src/knowledge/suggestion-cluster-scoring.test.ts --reporter=verbose
```
Expected: `isModelEligibleForScoring > returns false when model has no centroids at all` — PASS
Expected: `isModelEligibleForScoring > returns false when negative centroids present but member count below threshold` — PASS
Expected: `isModelEligibleForScoring > returns true when both classes meet threshold` — PASS

**2. Threshold boundary**
Expected: `scoreFindingEmbedding > suppresses when negative score meets threshold` — PASS (score ≥ 0.80)
Expected: `scoreFindingEmbedding > does NOT suppress when negative score is just below threshold` — PASS (score < 0.80)
Expected: `scoreFindingEmbedding > clamps boosted confidence to 100` — PASS

**3. Safety guard — CRITICAL and protected**
Expected: `scoreFindingEmbedding — safety guard > does NOT suppress CRITICAL findings even when similarity is above threshold` — PASS
Expected: `scoreFindingEmbedding — safety guard > does NOT boost CRITICAL findings (safety guard bypasses boost too)` — PASS
Expected: `scoreFindingEmbedding — safety guard > does NOT suppress MAJOR security findings` — PASS
Expected: `scoreFindingEmbedding — safety guard > CAN suppress MAJOR performance findings (not in protected list)` — PASS

**4. Fail-open paths**
Expected: `scoreFindings > returns modelUsed=false when model is null (fail-open)` — PASS
Expected: `scoreFindings > returns modelUsed=false when model is ineligible (fail-open)` — PASS
Expected: `scoreFindings > applies no signal (fail-open) when embedding provider throws` — PASS
Expected: `scoreFindings > applies no signal (fail-open) when embedding provider returns null` — PASS

**5. Conservative thresholds**
Expected: `conservative thresholds > SUPPRESSION_THRESHOLD is at least 0.80` — PASS
Expected: `conservative thresholds > BOOST_THRESHOLD is lower than SUPPRESSION_THRESHOLD` — PASS
Expected: `conservative thresholds > MIN_CENTROID_MEMBERS_FOR_SCORING is at least 5` — PASS

---

## Test Suite B: Unit Tests — Pipeline Integration (confidence-adjuster.test.ts)

**Precondition:** `src/feedback/confidence-adjuster.ts` exports `applyClusterScoreAdjustment`

```
bun test ./src/feedback/confidence-adjuster.test.ts --reporter=verbose
```

**6. applyClusterScoreAdjustment — safety guard**
Expected: `CRITICAL finding: cluster suppress signal is ignored (safety guard)` — PASS
Expected: `CRITICAL finding: confidence boost is ignored (safety guard)` — PASS
Expected: `MAJOR security finding: both suppression and boost are blocked (safety guard)` — PASS

**7. applyClusterScoreAdjustment — scoring paths**
Expected: `medium/style finding: cluster suppression is applied` — PASS
Expected: `minor finding: cluster confidence boost is applied` — PASS
Expected: `suppression takes precedence over boost (mutually exclusive paths)` — PASS
Expected: `confidence is clamped at 100 via boost path` — PASS

**8. applyClusterScoreAdjustment — fail-open**
Expected: `returns identity when clusterModelUsed is false (fail-open)` — PASS

---

## Test Suite C: Proof Harness (verify-m037-s02.test.ts)

```
bun test ./scripts/verify-m037-s02.test.ts --reporter=verbose
```

**9. Scoring changes findings vs naive path**
Expected: `M037-S02-SCORING-CHANGES-FINDINGS > passes with the real deterministic fixture` — PASS
Expected: `M037-S02-SCORING-CHANGES-FINDINGS > fails when naive path incorrectly suppresses finding` — PASS
Expected: `M037-S02-SCORING-CHANGES-FINDINGS > fails when scored path did not suppress the matching finding` — PASS
Expected: `M037-S02-SCORING-CHANGES-FINDINGS > fails when modelUsed=false in scored path` — PASS

**10. CRITICAL safety guard proof**
Expected: `M037-S02-SAFETY-GUARD-CRITICAL > passes with the real deterministic fixture` — PASS
Expected: `M037-S02-SAFETY-GUARD-CRITICAL > fails when CRITICAL finding was suppressed` — PASS
Expected: `M037-S02-SAFETY-GUARD-CRITICAL > fails when CRITICAL finding confidence was boosted` — PASS
Expected: `M037-S02-SAFETY-GUARD-CRITICAL > fails when criticalNegativeScore was null (guard not exercised)` — PASS

**11. Fail-open proof**
Expected: `M037-S02-FAIL-OPEN > passes with the real deterministic fixture` — PASS
Expected: `M037-S02-FAIL-OPEN > fails when modelUsed=true for null model path` — PASS
Expected: `M037-S02-FAIL-OPEN > fails when findings were suppressed in fail-open path` — PASS

**12. Harness meta**
Expected: `evaluateM037S02 > returns all three check ids and passes with real fixtures` — PASS
Expected: `buildM037S02ProofHarness > prints valid JSON in json mode` — PASS
Expected: `buildM037S02ProofHarness > returns exitCode 1 and stderr message when a check fails` — PASS

---

## Test D: Machine-Verifiable Proof Harness (CLI)

```
bun run verify:m037:s02 -- --json
```

Expected output (exit code 0):
```json
{
  "check_ids": ["M037-S02-SCORING-CHANGES-FINDINGS", "M037-S02-SAFETY-GUARD-CRITICAL", "M037-S02-FAIL-OPEN"],
  "overallPassed": true,
  "checks": [
    {
      "id": "M037-S02-SCORING-CHANGES-FINDINGS",
      "passed": true,
      "skipped": false,
      "status_code": "scoring_suppressed_and_boosted"
    },
    {
      "id": "M037-S02-SAFETY-GUARD-CRITICAL",
      "passed": true,
      "skipped": false,
      "status_code": "critical_findings_protected"
    },
    {
      "id": "M037-S02-FAIL-OPEN",
      "passed": true,
      "skipped": false,
      "status_code": "fail_open_preserved_all_findings"
    }
  ]
}
```

---

## Test E: TypeScript Gate

```
bun run tsc --noEmit
```
Expected: exit 0, no output.

---

## Edge Cases

**EC-1: CRITICAL finding at exactly SUPPRESSION_THRESHOLD similarity**
Exercise `scoreFindingEmbedding` directly with a CRITICAL severity finding and negative cosine similarity = exactly `SUPPRESSION_THRESHOLD`. Expected: `suppress=false`, `confidenceAdjustment=0` — safety guard fires before threshold comparison.

**EC-2: Already-suppressed finding skips cluster pass**
In `createReviewHandler`, a finding suppressed by `evaluateFeedbackSuppressions` (feedback-based suppression) should skip the `scoreFindings` call. The cluster cannot unsuppress. Verified by integration behavior — `alreadySuppressed` check in review.ts.

**EC-3: clusterModelStore absent from handler (optional dep)**
`createReviewHandler` called without `clusterModelStore` dep. Expected: all findings pass through unchanged (`clusterModelUsed=false` across the board), no error thrown, review completes normally.

**EC-4: Embedding provider timeout during scoreFindings()**
If `embeddingProvider.embed()` throws or returns null for a specific finding, that finding gets `suppress=false, confidenceAdjustment=0` (fail-open per-finding). Other findings in the same batch are unaffected. Verified by `scoreFindings > applies no signal (fail-open) when embedding provider throws` test.

