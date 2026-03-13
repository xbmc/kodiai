---
estimated_steps: 5
estimated_files: 5
---

# T02: Implement the composed S04 acceptance harness and package entrypoint

**Slice:** S04 — Final Integrated Production Repair Proof
**Milestone:** M027

## Description

Build the final milestone verifier as composition, not duplication. This task should reuse the existing S01/S02/S03 proof functions or extract reusable helpers where needed, then assemble a milestone-level verdict that requires a global green audit, real retriever hits, and durable completed repair-state evidence from both repair families.

## Steps

1. Refactor `scripts/verify-m027-s01.ts`, `scripts/verify-m027-s02.ts`, and `scripts/verify-m027-s03.ts` only as needed to expose reusable proof helpers without weakening their existing CLI behavior.
2. Implement `scripts/verify-m027-s04.ts` so it runs the prior proof surfaces with explicit repo/query/page/corpus inputs, preserves their raw evidence, and computes milestone-level checks for `full_audit`, `retriever`, `wiki_repair_state`, and `non_wiki_repair_state`.
3. Encode idempotent healthy-rerun semantics: accept `repair_not_needed` only when durable persisted status still proves prior bounded completion, and keep `issue_comments` explicitly under `not_in_retriever`.
4. Render human output from the same JSON-first envelope used by `--json`, with stable final status codes and check IDs.
5. Add the `verify:m027:s04` package alias and make the new test suite pass without regressing the existing S01/S02/S03 verifiers.

## Must-Haves

- [ ] S04 composes and preserves prior slice evidence instead of re-implementing repair or audit logic in a parallel path.
- [ ] The final verdict cannot pass unless the full six-corpus audit, retriever proof, wiki durable status, and non-wiki durable status all pass under the documented semantics.

## Verification

- `bun test ./scripts/verify-m027-s04.test.ts`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`

## Observability Impact

- Signals added/changed: Introduces one milestone-level proof envelope with stable top-level checks plus preserved subordinate evidence from S01/S02/S03.
- How a future agent inspects this: Run `bun run verify:m027:s04 -- --json` and drill into the nested evidence fields to see which subsystem regressed.
- Failure state exposed: The harness reports whether failure comes from global audit drift, retriever/query-embedding problems, wiki status drift, or non-wiki status drift.

## Inputs

- `scripts/verify-m027-s01.ts` — authoritative live audit + retriever composition pattern and evidence envelope.
- `scripts/verify-m027-s02.ts` and `scripts/verify-m027-s03.ts` — authoritative repair-family proof semantics, including idempotent reruns and durable status interpretation.

## Expected Output

- `scripts/verify-m027-s04.ts` — runnable final acceptance harness with stable JSON/human output and milestone-level verdict logic.
- `package.json` — `verify:m027:s04` alias wired to the new harness.
