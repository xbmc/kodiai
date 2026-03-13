# S04: Final Integrated Production Repair Proof

**Goal:** Prove the assembled M027 system end to end on the real production wiring: the full six-corpus audit stays green, the wiki and non-wiki repair families still expose durable completed state on idempotent reruns, and the live `createRetriever(...).retrieve(...)` path returns attributed hits from repaired corpora without overstating `issue_comments` coverage.
**Demo:** An operator runs one final acceptance command and gets a machine-checkable verdict backed by preserved S01/S02/S03 evidence: global audit passes for all six corpora, the retriever generates a real query embedding and returns live hits, wiki repair state remains completed for `JSON-RPC API/v8`, non-wiki repair state remains completed for `review_comments`, and `issue_comments` is still surfaced honestly as audited-but-not-in-retriever.
**Requirement support:** S04 is the milestone-closing support slice for R019, R020, R021, R022, R023, and R024.

## Must-Haves

- A dedicated `verify:m027:s04` proof harness composes the existing S01/S02/S03 proof surfaces instead of re-implementing repair logic, and preserves their raw evidence inside one final JSON envelope with stable check IDs and status codes.
- The final S04 verdict requires a milestone-wide `audit_ok` result across all six audited corpora, a passing live retriever check with attributed hits, durable wiki repair-state evidence, and durable non-wiki repair-state evidence; scoped slice-local audit passes alone are insufficient.
- Healthy idempotent reruns are treated as success only when the persisted repair-state surfaces still prove prior bounded completion; the harness must not require fresh mutations and must continue surfacing `issue_comments` under `not_in_retriever` truthfully.
- Operators get a stable package alias and runbook section for the final proof, including interpretation notes for `repair_not_needed`, `repair_resume_available`, retriever degradation, and the audited-only `issue_comments` boundary.
- Live execution against production wiring produces passing final-assembly evidence that can be used to close S04 and M027 without hand-waving or manual interpretation.

## Proof Level

- This slice proves: final-assembly
- Real runtime required: yes
- Human/UAT required: no

## Verification

- `bun test ./scripts/verify-m027-s04.test.ts`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments`
- `bun run repair:wiki-embeddings -- --status --json`
- `bun run repair:embeddings -- --corpus review_comments --status --json`

## Observability / Diagnostics

- Runtime signals: final-proof reports stable milestone-level check IDs plus nested raw `s01`, `s02`, and `s03` evidence, including `audit.status_code`, retriever query-embedding state, `not_in_retriever`, and both repair-family status/result codes.
- Inspection surfaces: `bun run verify:m027:s04 [--json]`, `bun run repair:wiki-embeddings -- --status --json`, `bun run repair:embeddings -- --corpus <name> --status --json`, `bun run audit:embeddings --json`, and the persisted `wiki_embedding_repair_state` / `embedding_repair_state` tables.
- Failure visibility: final proof must expose which check failed (`full_audit`, `retriever`, `wiki_repair_state`, `non_wiki_repair_state`), the relevant status code, and the preserved subordinate evidence needed to localize regressions without re-running exploratory commands.
- Redaction constraints: diagnostics must never emit raw embeddings, API keys, or full stored corpus text; use corpus names, identifiers, counts, status codes, model names, and summarized failure metadata only.

## Integration Closure

- Upstream surfaces consumed: `scripts/verify-m027-s01.ts`, `scripts/verify-m027-s02.ts`, `scripts/verify-m027-s03.ts`, `scripts/embedding-audit.ts`, `scripts/retriever-verify.ts`, `scripts/wiki-embedding-repair.ts`, `scripts/embedding-repair.ts`, `src/knowledge/retriever-verifier.ts`, and `docs/operations/embedding-integrity.md`.
- New wiring introduced in this slice: a final `verify:m027:s04` acceptance harness that composes prior proof functions at the runtime boundary, a package alias for that command, and operator documentation for interpreting milestone-level pass/fail evidence.
- What remains before the milestone is truly usable end-to-end: nothing within M027 if the planned live proof passes; `issue_comments` remaining outside the retriever is an explicitly documented system boundary, not unfinished M027 work.

## Tasks

- [x] **T01: Lock the final integrated proof contract with failing tests** `est:45m`
  - Why: S04 is mostly composition and verdict logic, so the final acceptance contract needs to be fixed before implementation to prevent hand-wavy milestone closure or accidental overstatement of retriever coverage.
  - Files: `scripts/verify-m027-s04.test.ts`, `scripts/verify-m027-s04.ts`
  - Do: Add failing tests for the final JSON and human report envelope, full-audit gating across all six corpora, idempotent healthy-rerun success, wiki/non-wiki resume-needed failure cases, retriever query-embedding failure handling, and honest `issue_comments:not_in_retriever` reporting.
  - Verify: `bun test ./scripts/verify-m027-s04.test.ts`
  - Done when: The tests fail only because the S04 harness and verdict logic do not exist yet, and the failures name the exact final-proof contract rather than placeholders.
- [x] **T02: Implement the composed S04 acceptance harness and package entrypoint** `est:1h15m`
  - Why: The slice only closes if operators can run one real command that reuses the existing S01/S02/S03 proof logic, preserves raw evidence, and returns a truthful milestone-level verdict.
  - Files: `scripts/verify-m027-s04.ts`, `scripts/verify-m027-s01.ts`, `scripts/verify-m027-s02.ts`, `scripts/verify-m027-s03.ts`, `package.json`
  - Do: Export or factor the prior proof helpers as needed, implement `verify:m027:s04` with stable check IDs and verdict rules, preserve nested raw evidence rather than flattening it, and add the package alias without reintroducing duplicate repair logic.
  - Verify: `bun test ./scripts/verify-m027-s04.test.ts`
  - Done when: The S04 harness passes its contract tests, runs from `bun run verify:m027:s04`, and fails/passes for the right reasons based on full-audit, retriever, and durable repair-state evidence.
- [x] **T03: Document the final operator proof and run the live acceptance pass** `est:1h`
  - Why: M027 is not closed by fixture-only composition; the final slice must prove the live runtime still works end to end and explain how operators interpret healthy idempotent reruns versus real regressions.
  - Files: `docs/operations/embedding-integrity.md`, `scripts/verify-m027-s04.ts`, `package.json`
  - Do: Extend the runbook with the final proof command, stable check IDs, interpretation notes for idempotent `repair_not_needed`, resume-needed failures, and the audited-only `issue_comments` boundary; then execute the final live proof and correct any truthfulness or reporting gaps exposed by the run.
  - Verify: `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json && bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments`
  - Done when: The runbook matches the real command contract, the live final proof passes against production wiring, and the output preserves enough detail to localize failures without additional exploratory work.
- [x] **T04: Close milestone evidence from the passing final proof** `est:45m`
  - Why: The final slice needs durable project-state closure, not just a passing terminal command; roadmap, requirements, and state artifacts must point at the exact passing S04 evidence.
  - Files: `.gsd/REQUIREMENTS.md`, `.gsd/milestones/M027/M027-ROADMAP.md`, `.gsd/PROJECT.md`, `.gsd/STATE.md`, `.gsd/milestones/M027/slices/S04/S04-SUMMARY.md`
  - Do: Record the exact S04 verification commands and outcomes, mark S04 and M027 complete only if the live proof passed, summarize the final system boundary around audited-only `issue_comments`, and update current-state docs so future agents inherit the milestone closure evidence instead of rediscovering it.
  - Verify: `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`
  - Done when: The GSD artifacts cite the passing S04 proof by command and outcome, milestone state is updated truthfully, and a future agent can tell from `.gsd/` alone that M027 reached final integrated acceptance.

## Files Likely Touched

- `scripts/verify-m027-s04.ts`
- `scripts/verify-m027-s04.test.ts`
- `scripts/verify-m027-s01.ts`
- `scripts/verify-m027-s02.ts`
- `scripts/verify-m027-s03.ts`
- `docs/operations/embedding-integrity.md`
- `package.json`
- `.gsd/REQUIREMENTS.md`
- `.gsd/milestones/M027/M027-ROADMAP.md`
- `.gsd/PROJECT.md`
- `.gsd/STATE.md`
- `.gsd/milestones/M027/slices/S04/S04-SUMMARY.md`
