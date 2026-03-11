# S11: Polish

**Goal:** Finish remaining polish items: make CI typecheck blocking, tighten guardrails refusal UX, add a non-chatty rereview trigger, and do a smoke test on xbmc repos.
**Demo:** Finish remaining polish items: make CI typecheck blocking, tighten guardrails refusal UX, add a non-chatty rereview trigger, and do a smoke test on xbmc repos.

## Must-Haves


## Tasks

- [x] **T01: 21-polish 01** `est:15 min`
  - Finish remaining polish items: make CI typecheck blocking, tighten guardrails refusal UX, add a non-chatty rereview trigger, and do a smoke test on xbmc repos.
- [x] **T02: 21-polish 02** `est:10 min`
  - Run a real-world smoke test of the end-to-end write flow against xbmc/kodiai (default) and document the exact steps and expected outputs, including how to grep evidence bundle logs by deliveryId.
- [x] **T03: 21-polish 03** `est:20 min`
  - Improve write guardrail refusal UX: include the triggering file/path, the triggering rule, and the smallest config change to allow it when safe.
- [x] **T04: 21-polish 04** `est:5 min`
  - Reduce real-world timeouts on large repos (notably xbmc/xbmc) by increasing the default execution timeout and making the timeout guidance more actionable.

## Files Likely Touched

- `.github/workflows/ci.yml`
- `src/lib/sanitizer.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/review.ts`
- `docs/runbooks/mentions.md`
- `docs/runbooks/mentions.md`
- `docs/smoke/xbmc-xbmc-write-flow.md`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/execution/config.ts`
- `src/execution/executor.ts`
- `src/lib/errors.ts`
