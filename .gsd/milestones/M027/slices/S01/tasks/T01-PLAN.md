---
estimated_steps: 4
estimated_files: 5
---

# T01: Lock audit and verifier contracts with failing tests

**Slice:** S01 — Live Audit & Retriever Verification Surface
**Milestone:** M027

## Description

Define the slice boundary first by adding failing tests that lock the audit and retriever-verifier contracts before implementation. This keeps later work honest about corpus coverage, model expectations, degraded-path reporting, and operator-visible JSON fields.

## Steps

1. Add `src/knowledge/embedding-audit.test.ts` covering per-corpus audit math, wiki-vs-non-wiki model invariants, unsupported `stale` semantics for `issues` and `issue_comments`, and code-snippet occurrence diagnostics.
2. Add `src/knowledge/retriever-verifier.test.ts` covering query-embedding generated, query-embedding unavailable/null, zero-hit retrieval, attributed `unifiedResults` hits, and explicit `issue_comments:not_in_retriever` reporting.
3. Add CLI contract tests in `scripts/embedding-audit.test.ts`, `scripts/retriever-verify.test.ts`, and `scripts/verify-m027-s01.test.ts` for JSON shape, human-output parity, and stable exit/success signaling.
4. Run the targeted suite and confirm it fails only because the implementation does not exist yet, not because the contract is ambiguous.

## Must-Haves

- [ ] Tests name the concrete files, commands, and JSON fields that S01 will ship.
- [ ] Degraded-path coverage is explicit: query embedding unavailable is asserted separately from no hits.
- [ ] Retriever coverage reporting includes `issue_comments` as a deliberate gap unless real wiring changes later.

## Verification

- `bun test src/knowledge/embedding-audit.test.ts src/knowledge/retriever-verifier.test.ts scripts/embedding-audit.test.ts scripts/retriever-verify.test.ts scripts/verify-m027-s01.test.ts`
- The suite exits non-zero because implementation is missing, while the failure output clearly points to the intended contracts rather than vague placeholders.

## Observability Impact

- Signals added/changed: Test-locked JSON fields for corpus status, model mismatch, query-embedding outcome, retriever participation, and combined proof status.
- How a future agent inspects this: Read the named tests to see the exact operator contract and degraded-path expectations before touching implementation.
- Failure state exposed: Contract drift becomes a deterministic test failure instead of a silent CLI behavior change.

## Inputs

- `src/knowledge/retrieval.e2e.test.ts` — existing patterns for real retriever result shape and backward-compatible fields.
- Slice research summary — audit must cover six persisted corpora while verifier must tell the truth about `issue_comments` not being in `createRetriever` today.

## Expected Output

- `src/knowledge/embedding-audit.test.ts` — failing contract tests for the read-only audit surface.
- `src/knowledge/retriever-verifier.test.ts` — failing contract tests for live retrieval verification states.
- `scripts/embedding-audit.test.ts` — failing CLI contract tests for the audit entrypoint.
- `scripts/retriever-verify.test.ts` — failing CLI contract tests for the verifier entrypoint.
- `scripts/verify-m027-s01.test.ts` — failing tests for the combined operator proof harness.
