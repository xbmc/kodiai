# T01: 64-policy-guardrails-completion 01

**Slice:** S05 — **Milestone:** M011

## Description

Add issue-surface-specific regression tests for allowPaths and secretScan refusal paths, completing the trio of policy guardrail tests for issue write-mode. Currently only denyPaths has issue-surface coverage; PR-surface has all three.

Purpose: Close the IWR-03 gap where policy guardrail behavior exists in code but issue-surface regression coverage is incomplete, leaving the phase unverifiable.
Output: Two new regression tests in mention.test.ts proving issue-surface allowPaths and secretScan refusals are deterministic with actionable user messaging.

## Must-Haves

- [ ] "Issue-surface allowPaths violation triggers a refusal reply containing the violated rule, the blocked file, and a concrete config snippet to fix it"
- [ ] "Issue-surface secretScan violation triggers a refusal reply containing the detector name and a safe remediation step without exposing secret content"
- [ ] "All three issue-surface policy refusal paths (denyPaths, allowPaths, secretScan) post exactly one issue-thread reply and zero PRs"

## Files

- `src/handlers/mention.test.ts`
