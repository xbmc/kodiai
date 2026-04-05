# S03: Timeout, Cache Reuse, and Fail-Open Verification — UAT

**Milestone:** M038
**Written:** 2026-04-05T21:12:56.944Z

## UAT: S03 — Timeout, Cache Reuse, and Fail-Open Verification

### Preconditions
- Working directory: `/home/keith/src/kodiai`
- Bun v1.3.8 installed
- `verify:m038:s03` npm script registered in `package.json`
- All S01 and S02 structural-impact files present

---

### TC-01: Cache reuse — second call for same (repo, baseSha, headSha) skips adapters

**Goal:** Confirm the handler-level cache causes the second call to return the cached payload without invoking adapters.

**Steps:**
1. Run `bun test ./src/structural-impact/cache.test.ts`
2. Confirm 4/4 pass, including "stores and retrieves by canonical repo/base/head cache key"

**Expected:** Exit 0, 4 pass, 0 fail.

**Edge cases tested in verifier:**
- `buildStructuralImpactCacheKey` lowercases repo — `MyRepo` and `myrepo` resolve to the same key
- LRU eviction: inserting 257 entries with `maxSize:256` evicts the oldest
- Partial (timeout-degraded) payloads are cached and served truthfully on cache-hit

---

### TC-02: Timeout fail-open — both substrate adapters exceed timeout → review not blocked

**Goal:** Confirm that when both adapters take longer than the configured timeout, the orchestrator returns `status=unavailable` and the call completes well before the adapter latency.

**Steps:**
1. Run `bun run verify:m038:s03 -- --json`
2. Find the `M038-S03-TIMEOUT-FAIL-OPEN` check in JSON output

**Expected:**
```json
{
  "id": "M038-S03-TIMEOUT-FAIL-OPEN",
  "passed": true,
  "status_code": "timeout_fail_open_verified",
  "detail": "... status=unavailable; degs=2; timeoutSignals=[graph=true,corpus=true]; ... completedBeforeAdapters=true; noInventedEvidence=true; fallbackUsed=true; hasNoRenderableEvidence=true"
}
```
- `elapsedMs` is < 400ms (against 500ms adapters)
- `changedFilesPreserved=true` — changed file list still present even when impact is unavailable

---

### TC-03: Substrate failure truthfulness — both adapters throw → no invented evidence

**Goal:** Confirm that when both adapters throw errors, the result contains no invented caller counts, no fake graph stats, no fabricated canonical evidence.

**Steps:**
1. Run `bun run verify:m038:s03 -- --json`
2. Find the `M038-S03-SUBSTRATE-FAILURE-TRUTHFUL` check

**Expected:**
```json
{
  "id": "M038-S03-SUBSTRATE-FAILURE-TRUTHFUL",
  "passed": true,
  "status_code": "substrate_failure_truthful_verified",
  "detail": "status=unavailable; degs=2; noCallers=true; noEvidence=true; noImpactedFiles=true; noTests=true; graphStatsNull=true; summaryStatus=unavailable; fallbackUsed=true; noRenderableEvidence=true; truthfulnessSignals=[graph-unavailable,corpus-unavailable,no-structural-evidence]"
}
```

---

### TC-04: Partial degradation truthfulness — asymmetric failure shows only available evidence

**Goal:** Confirm that when only one substrate fails, output contains evidence only from the live substrate and a degradation record for the failed one.

**Steps:**
1. Run `bun run verify:m038:s03 -- --json`
2. Find the `M038-S03-PARTIAL-DEGRADATION-TRUTHFUL` check

**Expected:**
```json
{
  "id": "M038-S03-PARTIAL-DEGRADATION-TRUTHFUL",
  "passed": true,
  "status_code": "partial_degradation_truthful_verified",
  "detail": "case1[graphOk+corpusFail]: status=partial; hasGraphEvidence=true; noCorpusEvidence=true; onlyCorpusDeg=true; graphAvail=true; corpusUnavail=true; hasRenderableEvidence=true | case2[graphFail+corpusOk]: status=partial; hasCorpusEvidence=true; noGraphEvidence=true; onlyGraphDeg=true; graphUnavail=true; corpusAvail=true; hasRenderableEvidence=true"
}
```

---

### TC-05: Degradation normalizer — correct status override

**Goal:** Confirm `summarizeStructuralImpactDegradation()` forces the correct status even when the raw payload says otherwise.

**Steps:**
1. Run `bun test ./src/structural-impact/degradation.test.ts`
2. Confirm 4/4 pass

**Expected output:** 4 pass including:
- "forces partial status when graph degradation exists even if payload status was ok"
- "forces unavailable status when both substrates degraded"
- "marks graph-empty when graph is available but contributes no evidence"

---

### TC-06: Full verifier JSON output — all four checks pass, overallPassed:true

**Steps:**
1. Run `bun run verify:m038:s03 -- --json`

**Expected:**
```json
{
  "overallPassed": true,
  "checks": [
    { "id": "M038-S03-CACHE-REUSE", "passed": true, ... },
    { "id": "M038-S03-TIMEOUT-FAIL-OPEN", "passed": true, ... },
    { "id": "M038-S03-SUBSTRATE-FAILURE-TRUTHFUL", "passed": true, ... },
    { "id": "M038-S03-PARTIAL-DEGRADATION-TRUTHFUL", "passed": true, ... }
  ]
}
```
Exit code: 0

---

### TC-07: TypeScript compilation clean

**Steps:**
1. Run `bun run tsc --noEmit`

**Expected:** Exit 0, no output.

---

### TC-08: All structural-impact tests pass

**Steps:**
1. Run `bun test ./src/structural-impact/`

**Expected:** Exit 0, 61 pass, 0 fail across 5 files (adapters, cache, degradation, orchestrator, review-integration).

---

### TC-09: Verifier test suite — 11/11

**Steps:**
1. Run `bun test ./scripts/verify-m038-s03.test.ts`

**Expected:** Exit 0, 11 pass, 0 fail including:
- Per-check: 4 pass/fail tests
- Full harness: overallPassed=false when any check fails
- JSON round-trip stability
- Human-readable output mode
- Failure harness writes to stderr and returns exit code 1

---

### TC-10: Verifier failure path — non-zero exit and stderr on fabricated failure

**Goal:** Confirm the verifier returns exit code 1 and writes FAIL lines to stderr when a check fails (important for CI gating).

**Steps:**
1. Verify test "buildM038S03ProofHarness > failure harness writes status codes to stderr and returns exit code 1" passes in TC-09 output

**Expected:** Test passes, confirming failure harness produces exit code 1 and stderr FAIL lines.

