# T01: 74-reliability-regression-gate 01

**Slice:** S03 — **Milestone:** M013

## Description

Lock issue write-mode PR creation failure semantics so maintainers get deterministic, machine-checkable reliability signals instead of false success.

Purpose: Phase 74 requires release gating that catches write-mode publish regressions before ship, including implicit issue write-intent paths.
Output: Hardened mention write-mode publish contract and regression tests covering retry-once failure handling, diagnostics quality, required success artifacts, and combined degraded+retrieval behavior safety.

## Must-Haves

- [ ] "Issue write-intent requests (explicit and implicit) never report success when branch push or PR creation fails"
- [ ] "If PR creation flow fails, runtime retries exactly once, then returns machine-checkable failure status `pr_creation_failed`"
- [ ] "Failure replies include exact failed step and actionable diagnostics instead of vague environment-limit phrasing"
- [ ] "Gate pass evidence requires all three artifacts: successful branch push, posted PR URL, and posted issue linkback comment"
- [ ] "Combined degraded + issue-write scenarios preserve retrieval-behavior safety (bounded/markdown-safe retrieval context) while enforcing the same write-mode failure contract"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
