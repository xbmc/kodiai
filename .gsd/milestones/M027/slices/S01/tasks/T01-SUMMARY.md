---
id: T01
parent: S01
milestone: M027
provides:
  - Failing contract tests for the S01 embedding audit, live retriever verifier, and combined proof harness
key_files:
  - src/knowledge/embedding-audit.test.ts
  - src/knowledge/retriever-verifier.test.ts
  - scripts/embedding-audit.test.ts
  - scripts/retriever-verify.test.ts
  - scripts/verify-m027-s01.test.ts
key_decisions:
  - Locked `stale_support` alongside `stale` counts for corpora that do not expose stale semantics in schema
  - Locked stable `success` and `status_code` fields for audit/verifier/proof-harness machine output
patterns_established:
  - Contract tests load future modules dynamically and fail with explicit missing-implementation errors until T02-T04 land
  - CLI tests assert JSON/human parity and stable exit behavior through injected runners rather than shell-only black-box checks
observability_surfaces:
  - Contract-locked JSON fields for corpus status, degraded query-embedding outcomes, retriever participation gaps, and combined proof verdicts
duration: 30m
verification_result: passed
completed_at: 2026-03-11T15:35:00-07:00
blocker_discovered: false
---

# T01: Lock audit and verifier contracts with failing tests

**Added failing contract tests that define the exact S01 audit/verifier JSON surfaces, degraded-path states, and CLI exit semantics before implementation exists.**

## What Happened

I added five new test files to lock the slice boundary before any runtime code exists:

- `src/knowledge/embedding-audit.test.ts`
  - locks the six audited corpora
  - locks wiki=`voyage-context-3` vs non-wiki=`voyage-code-3`
  - locks `issues`/`issue_comments` as `stale_support: not_supported`
  - locks `code_snippets` occurrence diagnostics via `code_snippet_occurrences`
- `src/knowledge/retriever-verifier.test.ts`
  - locks audited vs participating corpora
  - locks `issue_comments` as explicit `not_in_retriever`
  - locks separate `query_embedding_unavailable` vs `retrieval_no_hits` outcomes
  - locks attributed hit evidence derived from `unifiedResults`
- `scripts/embedding-audit.test.ts`
  - locks `bun run audit:embeddings [--json]` CLI parsing, JSON/human parity, and exit behavior
- `scripts/retriever-verify.test.ts`
  - locks `bun run verify:retriever --repo <repo> --query <query> [--json]` parsing, degraded-path reporting, and exit behavior
- `scripts/verify-m027-s01.test.ts`
  - locks the combined proof harness verdict model and stable pass/fail signaling

The tests are intentionally red and fail with explicit “Missing S01 implementation” errors so later work has a precise target instead of vague placeholders.

## Verification

Ran the task-level verification command exactly as written:

- `bun test src/knowledge/embedding-audit.test.ts src/knowledge/retriever-verifier.test.ts scripts/embedding-audit.test.ts scripts/retriever-verify.test.ts scripts/verify-m027-s01.test.ts`
  - exited non-zero as expected
  - Bun treated bare `scripts/...` arguments as filename filters rather than explicit paths, so only the two `src/knowledge` files executed

Ran the corrected explicit-path form to verify all five contract files:

- `bun test ./src/knowledge/embedding-audit.test.ts ./src/knowledge/retriever-verifier.test.ts ./scripts/embedding-audit.test.ts ./scripts/retriever-verify.test.ts ./scripts/verify-m027-s01.test.ts`
  - exited non-zero as expected
  - all 14 failing tests pointed at missing S01 implementation files/exports, which is the intended red state for T01

Ran the slice-level commands and confirmed they are still expected failures because T02-T04 have not shipped yet:

- `bun run audit:embeddings --json` → failed: script not found
- `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json` → failed: script not found
- `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"` → failed: script not found

## Diagnostics

Future agents can inspect the exact S01 operator contract directly in:

- `src/knowledge/embedding-audit.test.ts`
- `src/knowledge/retriever-verifier.test.ts`
- `scripts/embedding-audit.test.ts`
- `scripts/retriever-verify.test.ts`
- `scripts/verify-m027-s01.test.ts`

These tests now expose the intended JSON fields and degraded states before implementation:

- audit: `total`, `missing_or_null`, `stale`, `stale_support`, `model_mismatch`, `expected_model`, `actual_models`, `status`, `severity`, occurrence diagnostics, `success`, `status_code`
- verifier: `audited_corpora`, `participating_corpora`, `not_in_retriever`, `query_embedding`, `result_counts`, attributed `hits`, `success`, `status_code`
- combined harness: stable check IDs and final pass/fail verdict

## Deviations

- The written Bun test command does not exercise bare `scripts/...` paths under Bun 1.3.8. I ran the exact command for traceability, then ran the same suite again with `./` prefixes so all five intended files were actually verified.

## Known Issues

- `src/knowledge/embedding-audit.ts` does not exist yet.
- `src/knowledge/retriever-verifier.ts` does not exist yet.
- `scripts/embedding-audit.ts` does not exist yet.
- `scripts/retriever-verify.ts` does not exist yet.
- `scripts/verify-m027-s01.ts` does not exist yet.
- `package.json` does not yet define `audit:embeddings`, `verify:retriever`, or `verify:m027:s01`.

## Files Created/Modified

- `src/knowledge/embedding-audit.test.ts` — failing contract tests for per-corpus audit math, model expectations, stale-support semantics, and human rendering
- `src/knowledge/retriever-verifier.test.ts` — failing contract tests for live verifier states, attributed hits, and retriever participation reporting
- `scripts/embedding-audit.test.ts` — failing CLI contract tests for audit parsing, JSON/human parity, and exit signaling
- `scripts/retriever-verify.test.ts` — failing CLI contract tests for verifier parsing, degraded-path separation, and exit signaling
- `scripts/verify-m027-s01.test.ts` — failing contract tests for the combined proof harness verdict model and exit behavior
- `.gsd/milestones/M027/slices/S01/S01-PLAN.md` — marked T01 complete
- `.gsd/DECISIONS.md` — recorded the contract decision for `stale_support` plus stable `success`/`status_code` fields
- `.gsd/STATE.md` — advanced the next action to T02
