# S06: Fix TS2532 in verify-m031.test.ts — R001 remediation — UAT

**Milestone:** M031
**Written:** 2026-03-28T18:05:23.217Z

## UAT: S06 — Fix TS2532

### Verification

```
bunx tsc --noEmit
# exits 0, no output

bun test ./scripts/verify-m031.test.ts
# 23 pass, 0 fail
```

### Pass criteria
- `bunx tsc --noEmit` exits 0 with no errors across the codebase ✅

