# T02: 64-policy-guardrails-completion 02

**Slice:** S05 — **Milestone:** M011

## Description

Add unit-level tests for the write policy enforcement function and refusal message builder, proving guardrail behavior at the lowest testable layer independent of the full mention handler integration.

Purpose: Provide focused unit coverage that validates policy logic in isolation, complementing the integration-level tests from plan 01. Export `enforceWritePolicy` for direct testing.
Output: A new workspace.test.ts with unit tests covering denyPaths, allowPaths, secretScan enforcement, and refusal message formatting.

## Must-Haves

- [ ] "enforceWritePolicy rejects denied paths with the first matching pattern and file path in the error metadata"
- [ ] "enforceWritePolicy rejects paths outside allowPaths when allowPaths is non-empty"
- [ ] "enforceWritePolicy passes all paths when allowPaths is empty (no restriction)"
- [ ] "buildWritePolicyRefusalMessage produces a config snippet for allowPaths violations and safe remediation for secret violations"

## Files

- `src/jobs/workspace.ts`
- `src/jobs/workspace.test.ts`
