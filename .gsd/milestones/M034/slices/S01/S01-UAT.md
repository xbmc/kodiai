# S01: Capture Claude Code usage events — UAT

**Milestone:** M034
**Written:** 2026-04-02T20:16:25.926Z

# S01 UAT: Capture Claude Code usage events

## Preconditions
- Repo checked out, `bun install` complete
- `bun test` and `bun tsc --noEmit` available in PATH

---

## TC-01 — Single rate_limit_event populates usageLimit

**Precondition:** agent-entrypoint.test.ts contains the `makeRateLimitEvent` helper.

**Steps:**
1. Run `bun test src/execution/agent-entrypoint.test.ts --test-name-pattern "single event captured"`

**Expected outcome:**
- Test passes: `parsedResult.usageLimit` equals `{ utilization: 0.75, rateLimitType: 'seven_day', resetsAt: 9999 }`
- Exit 0

---

## TC-02 — Last rate_limit_event wins when multiple emitted

**Steps:**
1. Run `bun test src/execution/agent-entrypoint.test.ts --test-name-pattern "last event wins"`

**Expected outcome:**
- Test passes: `usageLimit.utilization === 0.9`, `usageLimit.rateLimitType === 'seven_day_sonnet'`
- The first event's `utilization: 0.5` is overwritten
- Exit 0

---

## TC-03 — usageLimit absent when no rate_limit_event emitted

**Steps:**
1. Run `bun test src/execution/agent-entrypoint.test.ts --test-name-pattern "usageLimit absent"`

**Expected outcome:**
- Test passes: `parsedResult.usageLimit === undefined`
- The key is fully absent from the result JSON (not null, not `{}`)
- Exit 0

---

## TC-04 — usageLimit defined but sub-fields undefined when event omits optional fields

**Steps:**
1. Run `bun test src/execution/agent-entrypoint.test.ts --test-name-pattern "sub-fields undefined"`

**Expected outcome:**
- Test passes: `usageLimit` is defined, but `usageLimit.utilization === undefined && usageLimit.rateLimitType === undefined && usageLimit.resetsAt === undefined`
- Exit 0

---

## TC-05 — Full suite regression

**Steps:**
1. Run `bun test src/execution/agent-entrypoint.test.ts`

**Expected outcome:**
- 17 tests pass, 0 fail
- All 4 `rate_limit_event capture` tests listed in output

---

## TC-06 — TypeScript clean

**Steps:**
1. Run `bun tsc --noEmit`

**Expected outcome:**
- 0 errors, 0 warnings
- Exit 0

---

## TC-07 — usageLimit field accessible on ExecutionResult type

**Precondition:** TypeScript type check passes (TC-06).

**Steps:**
1. Inspect `src/execution/types.ts` for the `usageLimit` field definition.

**Expected outcome:**
- Field present as optional: `usageLimit?: { utilization: number | undefined; rateLimitType: string | undefined; resetsAt: number | undefined; }`
- S02 code can access `result.usageLimit?.utilization` etc. without casting

---

## Edge Cases

- **No rate_limit_event at all** → `usageLimit` key absent in result.json (TC-03)
- **Multiple rate_limit_events** → only the last one is reflected (TC-02)
- **Event with no optional fields** → `usageLimit` present but all sub-fields `undefined` (TC-04)
- **Error path (SDK throws or no result)** → `usageLimit` never set; error-path result objects unchanged

