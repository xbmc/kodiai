---
id: T04
parent: S01
milestone: M027
provides:
  - Combined `verify:m027:s01` proof harness, package entrypoint, and operator runbook for the S01 audit/retriever surfaces
key_files:
  - scripts/verify-m027-s01.ts
  - docs/operations/embedding-integrity.md
  - package.json
  - .gsd/milestones/M027/slices/S01/S01-PLAN.md
key_decisions:
  - Keep raw `audit` and `retriever` envelopes in `verify:m027:s01 --json` while the default human output stays summary-first with stable check IDs and status codes
patterns_established:
  - Combined operator harnesses should preserve underlying machine-readable evidence instead of collapsing multiple checks into one opaque verdict
observability_surfaces:
  - `bun run verify:m027:s01 [--json]`
  - `docs/operations/embedding-integrity.md`
  - Stable check IDs `M027-S01-AUDIT` and `M027-S01-RETRIEVER`
duration: 1h
verification_result: passed
completed_at: 2026-03-12T06:43:00Z
blocker_discovered: false
---

# T04: Ship the operator proof harness and package entrypoints

**Added the combined `verify:m027:s01` proof harness, package alias, and operator runbook that expose both audit and retriever evidence without hiding degraded states.**

## What Happened

I implemented `scripts/verify-m027-s01.ts` as the slice-level proof harness. It reuses the shipped audit and retriever CLI surfaces, evaluates two stable checks (`M027-S01-AUDIT` and `M027-S01-RETRIEVER`), renders a concise human verdict by default, and emits a machine-readable JSON envelope with the raw `audit` and `retriever` results preserved under `--json`.

I added the `verify:m027:s01` package alias in `package.json` and wrote `docs/operations/embedding-integrity.md` to document:
- the audit command
- the live retriever verifier
- the combined proof harness
- required runtime/env assumptions
- degraded states and how to interpret them
- the current `issue_comments` retriever participation gap

I also marked T04 complete in the slice plan, updated `.gsd/STATE.md`, and appended the harness output-shape decision to `.gsd/DECISIONS.md`.

## Verification

Verified implementation and contracts:
- `bun test ./scripts/verify-m027-s01.test.ts` ✅
- `bun test ./src/knowledge/embedding-audit.test.ts ./src/knowledge/retriever-verifier.test.ts ./scripts/embedding-audit.test.ts ./scripts/retriever-verify.test.ts ./scripts/verify-m027-s01.test.ts` ✅

Verified live operator commands end to end:
- `bun run audit:embeddings --json` ✅ command executed and truthfully returned `status_code: audit_failed` because live data currently has review-comment missing embeddings and wiki model mismatches
- `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json` ✅ returned `status_code: retrieval_hits` with attributed snippet hits and `not_in_retriever: ["issue_comments"]`
- `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"` ✅ command executed end to end and returned a failing final verdict because the live audit currently fails; this is surfaced explicitly as `M027-S01-AUDIT:audit_failed` rather than being masked

Note: the slice proof surfaces are shipped and verified. The combined live command currently exits non-zero because it is correctly reporting real corpus integrity failures, not because the harness is broken.

## Diagnostics

Future agents/operators can inspect this work via:
- `bun run verify:m027:s01 --repo <owner/repo> --query "..."`
- `bun run verify:m027:s01 --repo <owner/repo> --query "..." --json`
- `bun run audit:embeddings --json`
- `bun run verify:retriever --repo <owner/repo> --query "..." --json`
- `docs/operations/embedding-integrity.md`

The combined harness exposes stable check IDs, per-check `status_code`, and preserved raw `audit` / `retriever` envelopes so a future agent can tell whether a failure comes from persisted data integrity, query embedding degradation, retriever unavailability, zero hits, or retriever corpus gaps.

## Deviations

None.

## Known Issues

- Live S01 proof currently fails on the audit half because existing production data is unhealthy: `review_comments` has missing embeddings and `wiki_pages` embeddings use the wrong model for the new audit expectation.
- `issue_comments` remains outside the live retriever and is intentionally surfaced as `not_in_retriever` rather than hidden.

## Files Created/Modified

- `scripts/verify-m027-s01.ts` — combined proof harness with stable check IDs, human rendering, JSON output, and exit behavior
- `docs/operations/embedding-integrity.md` — operator runbook for audit/verifier commands, degraded states, and retriever coverage semantics
- `package.json` — added `verify:m027:s01` script alias
- `.gsd/DECISIONS.md` — appended the combined harness JSON/human output-shape decision
- `.gsd/milestones/M027/slices/S01/S01-PLAN.md` — marked T04 complete
- `.gsd/STATE.md` — updated active state after slice completion
