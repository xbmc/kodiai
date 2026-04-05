# S01: Cluster Model Build and Cache — UAT

**Milestone:** M037
**Written:** 2026-04-05T07:50:17.541Z

## UAT: M037/S01 — Cluster Model Build and Cache

### Preconditions

- Repo checked out, `bun install` complete
- PostgreSQL not required — all tests are unit tests with SQL stubs

---

### Test Case 1: Migration file is present and idempotent

**Steps:**
1. `ls src/db/migrations/036-suggestion-cluster-models.sql`

**Expected:** File exists with CREATE TABLE IF NOT EXISTS, expires_at column, positive_centroids/negative_centroids as JSONB, positive_member_count/negative_member_count as INTEGER.

---

### Test Case 2: Store unit tests pass — all 29 green

**Steps:**
1. `bun test ./src/knowledge/suggestion-cluster-store.test.ts`

**Expected:** 29 pass, 0 fail. Tests cover: getModel (returns null on miss), getModel (TTL filter present in query), getModelIncludingStale (no TTL filter), saveModel (ON CONFLICT DO UPDATE), saveModel (default TTL applied), deleteModel, listExpiredModelRepos (limit default 50, clamped to min 1), centroid serialization round-trip (Float32Array values preserved), JSONB string parse.

---

### Test Case 3: Builder unit tests pass — all 26 green

**Steps:**
1. `bun test ./src/knowledge/suggestion-cluster-builder.test.ts`

**Expected:** 26 pass, 0 fail. Tests cover: insufficient data returns built=false, outcome class splitting (accepted/thumbs_up=positive; suppressed/thumbs_down=negative; unknown skipped), centroid generation with sufficient data, independent positive/negative clustering, MIN_CLUSTER_MEMBERS=3 threshold filtering, saveModel called exactly once, fail-open on sql error and store error, embedding parsing (pgvector string format), unparseable embedding skipped.

---

### Test Case 4: Refresh unit tests pass — all 20 green

**Steps:**
1. `bun test ./src/knowledge/suggestion-cluster-refresh.test.ts`

**Expected:** 20 pass, 0 fail. Tests cover: explicit repos sweep (correct totals, built=true on success, skipped on insufficient data), empty explicit repos returns zero without calling buildFn, store sweep (fetches expired repos, zero when none expired), maxReposPerRun respected (default 50), fail-open (continues after crash, failed=true in repoResults, warn log emitted, healthy repos still counted), mixed outcomes tallied correctly, durationMs non-negative, sum of built+skipped+failed equals repoCount, info log emitted on completion.

---

### Test Case 5: Proof harness tests pass — all 20 green

**Steps:**
1. `bun test ./scripts/verify-m037-s01.test.ts`

**Expected:** 20 pass, 0 fail. Tests cover: BUILD-AND-CACHE passes with real deterministic fixture (built=true, positiveCentroidCount>0, saveModel called, correct repo), BUILD-AND-CACHE fails when built=false / positiveCentroidCount=0 / saveModel not called / wrong repo. REFRESH-SWEEP passes with real fixture (reposBuilt=repoCount, correct centroid count, reposFailed=0), fails when reposBuilt<repoCount / wrong centroid count / reposFailed>0. FAIL-OPEN passes with real fixture (sweep continues, warn log present, reposFailed=1), fails when sweep aborted / no warn log / reposFailed=0. evaluateM037S01 returns all three check IDs, overallPassed false on any failure. buildM037S01ProofHarness prints all three check IDs, valid JSON in json mode, exitCode=1 and stderr on failure.

---

### Test Case 6: Full slice suite in one command

**Steps:**
1. `bun test ./src/knowledge/suggestion-cluster-store.test.ts ./src/knowledge/suggestion-cluster-builder.test.ts ./src/knowledge/suggestion-cluster-refresh.test.ts ./scripts/verify-m037-s01.test.ts`

**Expected:** 95 pass, 0 fail.

---

### Test Case 7: TypeScript compilation clean

**Steps:**
1. `bun run tsc --noEmit`

**Expected:** Exit 0, no output.

---

### Test Case 8: Fail-open contract — builder never throws

**Verified by:** `buildClusterModel — error handling > does not throw — always returns a result` test. Builder wraps all paths in try/catch and returns `{ built: false, skipReason: error.message }` on any failure. No uncaught rejection possible.

---

### Test Case 9: Store TTL contract — getModel filters stale, getModelIncludingStale does not

**Verified by:** store tests `issues query with expires_at > now() filter (not stale)` and `issues query WITHOUT expires_at filter`. Live review consumers call `getModel` (stale rows invisible). Refresh job calls `getModelIncludingStale` to force rebuild even of stale rows.

---

### Test Case 10: Centroid serialization integrity

**Verified by:** store test `preserves Float32Array values through save→read cycle`. saveModel calls `Array.from(c)` on each centroid before JSONB serialization. getModel calls `new Float32Array(c)` on each row entry after deserialization. Values survive the round-trip without corruption.

