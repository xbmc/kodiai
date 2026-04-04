# S01: Generated Rule Schema, Store, and Proposal Candidates — UAT

**Milestone:** M036
**Written:** 2026-04-04T22:42:53.806Z

## Preconditions

- Bun ≥ 1.3.8 installed
- `bun install` completed in project root
- `TEST_DATABASE_URL` may be unset (DB-gated tests skip gracefully)
- Run all commands from project root

---

## TC-01: Proposal generator rejects sparse input (< 5 memories)

**Test:** `generatePendingRuleProposals` with fewer qualifying memories than `minClusterSize`

**Steps:**
1. Import `generatePendingRuleProposals` in a REPL or test file
2. Provide a `sql` stub returning an array of 3 memories with embeddings
3. Call with default options (`minClusterSize` defaults to 5)

**Expected:** Returns `[]` immediately; logger emits `info` with `"Skipped generated-rule proposals: too few clustered memories"`

**Automated coverage:** `bun test ./src/knowledge/generated-rule-proposals.test.ts` — test `"returns empty when there are too few memories to cluster"`

---

## TC-02: Proposal generator produces bounded candidate from strong positive cluster

**Test:** `generatePendingRuleProposals` with a cluster of ≥ 5 positive memories above similarity threshold

**Steps:**
1. Supply 6 memories with high cosine similarity and `outcome: "accepted"` (or `"thumbs_up"`)
2. Call with default options

**Expected:**
- Returns exactly 1 `GeneratedRuleProposalCandidate`
- `signalScore > 0` and `≤ 1`
- `title` is non-empty, ≤ 80 chars
- `ruleText` is non-empty, ≤ 200 chars, ends with `.`
- `representativeMemoryId` matches one of the input memory IDs
- `positiveRatio ≥ 0.6`

**Automated coverage:** `bun test ./src/knowledge/generated-rule-proposals.test.ts` — test `"builds a bounded proposal from a strong positive cluster"`

---

## TC-03: Proposal generator skips noisy negative-heavy cluster

**Test:** Cluster where negative outcomes dominate (< 60% positive ratio)

**Steps:**
1. Supply 8 memories in a tight cluster: 2 accepted, 6 suppressed
2. Call `generatePendingRuleProposals` with default options

**Expected:** Returns `[]`; logger emits `info` with `reason: "low-positive-ratio"`

**Automated coverage:** `bun test ./src/knowledge/generated-rule-proposals.test.ts` — test `"skips a cluster that has too much negative signal"`

---

## TC-04: Store non-downgrading upsert preserves ACTIVE state

**Test:** `savePendingRule` called on a rule that is already ACTIVE

**Precondition:** Database with `TEST_DATABASE_URL` set and migration 035 applied

**Steps:**
1. Create a pending rule via `savePendingRule`
2. Activate it via `activateRule(rule.id)` — assert `status === "active"`
3. Call `savePendingRule` again with the same `repo` + `title` but different `ruleText`
4. Fetch via `getRule(rule.id)`

**Expected:**
- `status` remains `"active"` (not downgraded to `"pending"`)
- `ruleText` is updated to the new text (proposal data refreshed)

**Automated coverage:** `bun test ./src/knowledge/generated-rule-store.test.ts` (skips without `TEST_DATABASE_URL`) — test `"savePendingRule preserves active lifecycle state on reproposal"`

---

## TC-05: Store lifecycle counts reflect transitions

**Precondition:** Database with `TEST_DATABASE_URL` set and migration 035 applied

**Steps:**
1. Call `savePendingRule` three times for the same repo (three distinct titles)
2. Call `getLifecycleCounts(repo)` — assert `{ pending: 3, active: 0, retired: 0, total: 3 }`
3. Activate rule 1 via `activateRule`
4. Call `getLifecycleCounts(repo)` — assert `{ pending: 2, active: 1, retired: 0, total: 3 }`
5. Retire rule 2 via `retireRule`
6. Call `getLifecycleCounts(repo)` — assert `{ pending: 1, active: 1, retired: 1, total: 3 }`

**Automated coverage:** `bun test ./src/knowledge/generated-rule-store.test.ts` (requires DB) — test `"listRulesForRepo and getLifecycleCounts expose lifecycle surfaces"`

---

## TC-06: Sweep dry-run does not persist proposals

**Steps:**
1. Create a `createGeneratedRuleSweep` with injectable `_listReposFn` returning `["xbmc/xbmc"]` and `_generateFn` returning one proposal candidate
2. Inject a `_savePendingRuleFn` that throws `Error("should not be called")`
3. Call `sweep.run({ dryRun: true })`

**Expected:**
- Returns `{ proposalsGenerated: 1, proposalsPersisted: 0, dryRun: true }`
- The `_savePendingRuleFn` is never called (no throw)

**Automated coverage:** `bun test ./src/knowledge/generated-rule-sweep.test.ts` — test `"supports explicit repos and dry-run mode without persistence"`

---

## TC-07: Sweep continues after one repo crashes

**Steps:**
1. Configure sweep with two repos: `["owner/repo-a", "owner/repo-b"]`
2. Inject `_generateFn` that throws for `repo-a`, returns one proposal for `repo-b`
3. Inject `_savePendingRuleFn` that succeeds

**Expected:**
- Returns `{ reposProcessed: 1, reposFailed: 1, proposalsPersisted: 1 }`
- Logger emits `warn` for `repo-a`'s failure

**Automated coverage:** `bun test ./src/knowledge/generated-rule-sweep.test.ts` — test `"keeps sweeping later repos when one repo throws"`

---

## TC-08: Sweep continues after per-proposal persistence failure

**Steps:**
1. Configure sweep with one repo returning two proposals
2. Inject `_savePendingRuleFn` that throws on the first call, succeeds on the second

**Expected:**
- Returns `{ proposalsPersisted: 1, persistFailures: 1 }`
- Logger emits `warn` for the persistence failure

**Automated coverage:** `bun test ./src/knowledge/generated-rule-sweep.test.ts` — test `"keeps sweeping when proposal persistence fails"`

---

## TC-09: Proof harness exits 0 with both checks green

**Steps:**
```bash
bun run verify:m036:s01 -- --json
```

**Expected output (JSON):**
```json
{
  "overallPassed": true,
  "checks": [
    { "id": "M036-S01-PROPOSAL-CREATED", "passed": true, "skipped": false },
    { "id": "M036-S01-FAIL-OPEN",         "passed": true, "skipped": false }
  ]
}
```

Exit code: 0

**Automated coverage:** `bun test ./scripts/verify-m036-s01.test.ts`

---

## TC-10: Proof harness exits 1 when a check fails

**Steps:**
```bash
# Inject failing sweep (no proposals generated) via test
bun test ./scripts/verify-m036-s01.test.ts
```

Verify test `"fails when injected run returns no persisted proposals"` passes — it exercises the `exitCode: 1` path.

**Expected:** `overallPassed: false`, check `M036-S01-PROPOSAL-CREATED` has `passed: false`

---

## TC-11: TypeScript compilation gate

**Steps:**
```bash
bun run tsc --noEmit
```

**Expected:** exit 0, no output (clean type check across all new files and exports)

