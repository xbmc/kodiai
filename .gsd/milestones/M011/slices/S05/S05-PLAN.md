# S05: Policy Guardrails Completion

**Goal:** Add issue-surface-specific regression tests for allowPaths and secretScan refusal paths, completing the trio of policy guardrail tests for issue write-mode.
**Demo:** Add issue-surface-specific regression tests for allowPaths and secretScan refusal paths, completing the trio of policy guardrail tests for issue write-mode.

## Must-Haves


## Tasks

- [x] **T01: 64-policy-guardrails-completion 01** `est:2m`
  - Add issue-surface-specific regression tests for allowPaths and secretScan refusal paths, completing the trio of policy guardrail tests for issue write-mode. Currently only denyPaths has issue-surface coverage; PR-surface has all three.

Purpose: Close the IWR-03 gap where policy guardrail behavior exists in code but issue-surface regression coverage is incomplete, leaving the phase unverifiable.
Output: Two new regression tests in mention.test.ts proving issue-surface allowPaths and secretScan refusals are deterministic with actionable user messaging.
- [x] **T02: 64-policy-guardrails-completion 02** `est:9m`
  - Add unit-level tests for the write policy enforcement function and refusal message builder, proving guardrail behavior at the lowest testable layer independent of the full mention handler integration.

Purpose: Provide focused unit coverage that validates policy logic in isolation, complementing the integration-level tests from plan 01. Export `enforceWritePolicy` for direct testing.
Output: A new workspace.test.ts with unit tests covering denyPaths, allowPaths, secretScan enforcement, and refusal message formatting.

## Files Likely Touched

- `src/handlers/mention.test.ts`
- `src/jobs/workspace.ts`
- `src/jobs/workspace.test.ts`
