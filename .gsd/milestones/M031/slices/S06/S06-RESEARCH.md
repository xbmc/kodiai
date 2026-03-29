# S06 Research: Fix TS2532 in verify-m031.test.ts

**Researched:** 2026-03-28
**Depth:** Light — single-file, single-line TypeScript fix

---

## Summary

One TypeScript error in the entire codebase. Confirmed with `bunx tsc --noEmit`:

```
scripts/verify-m031.test.ts(221,12): error TS2532: Object is possibly 'undefined'.
```

---

## Error Details

**Location:** `scripts/verify-m031.test.ts`, line 221, column 12

**Context — "overallPassed is false when one check fails" test (envelope describe block):**
```ts
const failing = report.checks.filter((c) => !c.passed && !c.skipped);
expect(failing.length).toBeGreaterThanOrEqual(1);
expect(failing[0].id).toBe("M031-OUTGOING-SCAN-BLOCKS");  // ← line 221
```

`report.checks.filter(...)` returns `Check[]`. Array index access `Check[][0]` has type `Check | undefined` in TypeScript's type system — the compiler does not narrow based on the `expect(...).toBeGreaterThanOrEqual(1)` call above it (which is a runtime assertion, not a type guard).

**Fix:** Add a non-null assertion operator:
```ts
expect(failing[0]!.id).toBe("M031-OUTGOING-SCAN-BLOCKS");
```

The runtime invariant is already established (`expect(failing.length).toBeGreaterThanOrEqual(1)` immediately above). The `!` is purely a type-level declaration telling the compiler we've verified non-undefined.

---

## Verification

After the single-character edit, `bunx tsc --noEmit` should exit 0 with no output. Then confirm tests still pass with `bun test ./scripts/verify-m031.test.ts`.

---

## Recommendation

Single edit to `scripts/verify-m031.test.ts` line 221: `failing[0].id` → `failing[0]!.id`. No other files need touching. No architectural decisions, no new patterns.
