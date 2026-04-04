# S03: Retirement, Notification, and Lifecycle Proof — UAT

**Milestone:** M036
**Written:** 2026-04-04T23:16:03.042Z

## UAT: M036 S03 — Retirement, Notification, and Lifecycle Proof

### Preconditions

- Repository cloned and `bun install` complete
- `bun run tsc --noEmit` exits 0
- S01 and S02 modules present (`src/knowledge/generated-rule-store.ts`, `generated-rule-activation.ts`)

---

### Test 1: Retirement predicate — below-floor criterion

**Steps:**
1. Import `shouldRetireRule` from `src/knowledge/generated-rule-retirement.ts`
2. Call with a rule where `signalScore=0.2` and `floor=0.3`, `memberCount=10`, `minMemberCount=3`
3. Assert `shouldRetire=true`, `reason='below-floor'`

**Expected:** Function returns retirement decision with `shouldRetire=true` and `reason='below-floor'`.

---

### Test 2: Retirement predicate — member-decay criterion

**Steps:**
1. Call `shouldRetireRule` with `signalScore=0.8` (healthy), `floor=0.3`, `memberCount=2`, `minMemberCount=3`
2. Assert `shouldRetire=true`, `reason='member-decay'`

**Expected:** Function returns `shouldRetire=true` and `reason='member-decay'`.

---

### Test 3: Retirement predicate — boundary semantics (exactly at floor)

**Steps:**
1. Call `shouldRetireRule` with `signalScore=0.3` (exactly at floor) and `floor=0.3`
2. Assert `shouldRetire=false`

**Expected:** Exactly-at-floor rule is kept, not retired.

---

### Test 4: Retirement predicate — below-floor takes precedence

**Steps:**
1. Call `shouldRetireRule` with `signalScore=0.1`, `floor=0.3`, `memberCount=1`, `minMemberCount=3`
2. Assert `shouldRetire=true`, `reason='below-floor'` (not `'member-decay'`)

**Expected:** When both criteria apply, below-floor is the reported reason.

---

### Test 5: applyRetirementPolicy — retires qualifying rules, keeps healthy ones

**Steps:**
1. Build a store mock with two active rules: rule A (`signalScore=0.2`, below floor) and rule B (`signalScore=0.9`, healthy)
2. Call `applyRetirementPolicy({ store, logger, floor: 0.3, minMemberCount: 3 })`
3. Assert `result.retired=1`, `result.kept=1`, `result.retirementFailures=0`
4. Assert `retireRule` was called with rule A's id and NOT with rule B's id

**Expected:** Only the below-floor rule is retired; the healthy rule is kept.

---

### Test 6: applyRetirementPolicy — fail-open on retireRule error

**Steps:**
1. Build a store mock where `retireRule` throws on every call
2. Call `applyRetirementPolicy` with a below-floor rule
3. Assert the function does NOT throw
4. Assert `result.retirementFailures=1`

**Expected:** Errors during retirement are counted but do not propagate.

---

### Test 7: notifyLifecycleRun — emits events and calls hook

**Steps:**
1. Build a mock activation result with 1 activated rule and a mock retirement result with 1 retired rule
2. Provide a hook callback spy
3. Call `notifyLifecycleRun({ activationResult, retirementResult, logger, notifyHook: spy })`
4. Assert `result.activationEvents=1`, `result.retirementEvents=1`
5. Assert hook was called once with an array of 2 events

**Expected:** Hook receives both activation and retirement events in a single call.

---

### Test 8: notifyLifecycleRun — hook not called when no events

**Steps:**
1. Build empty activation and retirement results (no changed rules)
2. Provide a hook callback spy
3. Call `notifyLifecycleRun` with the spy
4. Assert hook was NOT called
5. Assert `result.notifyHookCalled=false`

**Expected:** Hook is skipped entirely when there are zero lifecycle events.

---

### Test 9: Fail-open — hook throw does not propagate

**Steps:**
1. Provide a hook that throws synchronously
2. Call `notifyRetirement` with one retired rule and the throwing hook
3. Assert the call does NOT throw
4. Assert `result.notifyHookFailed=true`
5. Assert `result.retirementEvents=1` (result still returned)

**Expected:** Hook failure is isolated — result is returned and notifyHookFailed signals the failure.

---

### Test 10: Fail-open — hook rejection (async) does not propagate

**Steps:**
1. Provide an async hook that returns a rejected promise
2. Call `notifyActivation` with one activated rule and the rejecting hook
3. Assert the call does NOT throw and `result.notifyHookFailed=true`

**Expected:** Async hook failures are also fail-open.

---

### Test 11: Lifecycle verifier — RETIREMENT check

**Steps:**
1. Run `bun run verify:m036:s03 -- --json`
2. Parse JSON output
3. Find check with `id='M036-S03-RETIREMENT'`
4. Assert `passed=true`, `skipped=false`
5. Assert `detail` contains `retired=1` and `floor=0.3`

**Expected:** Check passes and detail confirms a rule was retired against the default floor.

---

### Test 12: Lifecycle verifier — NOTIFY-LIFECYCLE check

**Steps:**
1. Run `bun run verify:m036:s03 -- --json`
2. Find check with `id='M036-S03-NOTIFY-LIFECYCLE'`
3. Assert `passed=true`, `skipped=false`
4. Assert `detail` contains `activationEvents=1 retirementEvents=1 hookCalled=true hookCallCount=2`

**Expected:** Check confirms hook received both activation and retirement events.

---

### Test 13: Lifecycle verifier — NOTIFY-FAIL-OPEN check

**Steps:**
1. Run `bun run verify:m036:s03 -- --json`
2. Find check with `id='M036-S03-NOTIFY-FAIL-OPEN'`
3. Assert `passed=true`, `skipped=false`
4. Assert `detail` contains `notifyHookFailed=true` and `warnCount=1` and `retirementEvents=1`

**Expected:** Check proves hook failure is absorbed (notifyHookFailed=true), warn emitted, result returned.

---

### Test 14: Full suite — 81/81

**Steps:**
1. Run `bun test ./src/knowledge/generated-rule-retirement.test.ts ./src/knowledge/generated-rule-notify.test.ts ./scripts/verify-m036-s03.test.ts`
2. Check final line for `81 pass, 0 fail`

**Expected:** All 81 tests pass with no failures.

---

### Test 15: TypeScript — no new errors

**Steps:**
1. Run `bun run tsc --noEmit`
2. Assert exit 0

**Expected:** No TypeScript errors introduced by S03 modules.
