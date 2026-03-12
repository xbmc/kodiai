---
estimated_steps: 4
estimated_files: 4
---

# T04: Ship the operator proof harness and package entrypoints

**Slice:** S01 — Live Audit & Retriever Verification Surface
**Milestone:** M027

## Description

Close the slice with one repeatable operator-facing harness that runs the audit and live verifier together, preserves the machine-checkable contract, and documents how to inspect degraded states.

## Steps

1. Implement `scripts/verify-m027-s01.ts` to run the audit and retriever verifier in sequence and summarize pass/fail evidence without masking the underlying JSON results.
2. Add package aliases for the combined proof harness and ensure it accepts the same repo/query inputs as the verifier.
3. Document the audit, verifier, expected degraded states, and current `issue_comments` retriever-gap semantics in `docs/operations/embedding-integrity.md`.
4. Make the combined harness tests pass and run the operator command end to end.

## Must-Haves

- [ ] One command exercises both S01 proof surfaces and returns machine-checkable results.
- [ ] Documentation matches the shipped commands, flags required env/runtime assumptions, and explains degraded embedding output without exposing secrets.
- [ ] The combined harness preserves explicit visibility into audit failures, verifier failures, and retriever coverage gaps instead of collapsing them into a generic error.

## Verification

- `bun test scripts/verify-m027-s01.test.ts`
- `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"`

## Observability Impact

- Signals added/changed: Combined pass/fail summary that references both audit and verifier evidence while preserving underlying structured results.
- How a future agent inspects this: Run one command for slice-level proof, then drill into `audit:embeddings` or `verify:retriever` outputs using the documented fields.
- Failure state exposed: The operator harness identifies which proof surface failed and whether the failure is due to data integrity, provider degradation, or retriever participation gaps.

## Inputs

- `src/knowledge/embedding-audit.ts` and `scripts/embedding-audit.ts` — completed read-only audit surface from T02.
- `src/knowledge/retriever-verifier.ts` and `scripts/retriever-verify.ts` — live verifier surface from T03.

## Expected Output

- `scripts/verify-m027-s01.ts` — combined operator verification harness for the slice.
- `docs/operations/embedding-integrity.md` — operator runbook for audit/verifier usage and failure interpretation.
- `package.json` — `verify:m027:s01` script alias.
