# Phase 74: Reliability Regression Gate - Context

**Gathered:** 2026-02-17
**Status:** Ready for planning

<domain>
## Phase Boundary

For this phase, lock release-gating around issue write-mode PR creation reliability so maintainers can deterministically verify that issue write-intent flows can create branches, push changes, and open PRs in real runtime conditions.

This phase clarifies HOW the reliability gate works for issue write-mode PR creation failures and diagnostics. Broader reliability gate concerns are deferred.

</domain>

<decisions>
## Implementation Decisions

### Failure Handling Policy (issue write-mode)
- If PR creation path fails, retry once, then fail with explicit machine-checkable status (`pr_creation_failed` or concrete equivalent).
- Do not report success if branch push/PR creation did not complete.

### Error Disclosure Quality
- Do not hide failures behind vague wording when concrete failure cause is available.
- If root cause is truly unknown, generic wording is acceptable, but output must still include actionable diagnostics and the exact failed step.
- Replace "shell environment limitation" style phrasing with step-level failure details whenever possible.

### Required Success Evidence for Gate Pass
- Gate must prove all three artifacts exist:
  - branch push succeeded
  - PR URL exists and is posted
  - issue linkback comment exists
- Missing any one artifact is a gate failure.

### Trigger Coverage in Scope
- Apply guarantee to all issue write-intent paths (explicit and implicit), not only `@kodiai apply:` / `@kodiai change:`.

### Runtime Environment Validation
- Add a deterministic runtime check in Azure container context to validate GitHub CLI/App capabilities needed for write mode:
  - branch creation permissions
  - push permissions to bot branch strategy
  - PR creation permissions for `xbmc/xbmc`
- Gate must fail if runtime auth/permission prerequisites are not verifiably available.

### Claude's Discretion
- Exact status code taxonomy beyond the locked failure semantics.
- Exact diagnostic field format and log schema.
- Exact structure of runtime capability probes as long as they remain deterministic and non-destructive.

</decisions>

<specifics>
## Specific Ideas

- Regression signal came from issue write-mode responses that claimed changes but did not actually open PRs:
  - `https://github.com/xbmc/xbmc/issues/27805#issuecomment-3913617298`
  - `https://github.com/xbmc/xbmc/issues/27874#issuecomment-3913634388`
- User intent: "I want you to have the ability to open PRs for issues" and to see exact failure causes instead of vague environment-limit messages.

</specifics>

<deferred>
## Deferred Ideas

- Remaining non-issue-write portions of the original Phase 74 reliability gate scope are deferred to a future phase.
- Keep this phase focused on issue write-mode PR-creation reliability and runtime capability verification.

</deferred>

---

*Phase: 74-reliability-regression-gate*
*Context gathered: 2026-02-17*
