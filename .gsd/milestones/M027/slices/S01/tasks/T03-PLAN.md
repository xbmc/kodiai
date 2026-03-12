---
estimated_steps: 4
estimated_files: 7
---

# T03: Reuse production wiring and implement the live retriever verifier

**Slice:** S01 — Live Audit & Retriever Verification Surface
**Milestone:** M027

## Description

Extract reusable production knowledge wiring from `src/index.ts` and build a verifier that exercises the real `createRetriever(...).retrieve(...)` path with explicit success and degraded states.

## Steps

1. Extract shared knowledge-runtime composition into `src/knowledge/runtime.ts` so the server and operator scripts use the same provider/store wiring, including wiki’s contextual embedding provider.
2. Update `src/index.ts` to consume the shared runtime factory without changing existing startup behavior or fail-open semantics.
3. Implement `src/knowledge/retriever-verifier.ts` and `scripts/retriever-verify.ts` to run a live query, report query-embedding outcome, participating corpora, attributed `unifiedResults`, and any audited corpus that is currently `not_in_retriever`.
4. Make the verifier tests pass and run the command against real runtime wiring to confirm it distinguishes query-embedding failure from zero hits.

## Must-Haves

- [ ] The verifier calls `createRetriever(...).retrieve(...)` rather than querying tables directly.
- [ ] Wiki verification uses the same `voyage-context-3` routing as production, while non-wiki corpora use the standard provider path.
- [ ] `issue_comments` are reported honestly as `not_in_retriever` unless the retriever itself is truly extended.

## Verification

- `bun test src/knowledge/retriever-verifier.test.ts scripts/retriever-verify.test.ts`
- `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json`

## Observability Impact

- Signals added/changed: Verifier result fields for provider mode, query-embedding state, participating corpora, attributed hit counts, and retriever coverage gaps.
- How a future agent inspects this: Run `bun run verify:retriever ... --json` or read `src/knowledge/runtime.ts` to see the exact production wiring reused by scripts.
- Failure state exposed: No-op provider mode, query embedding null, fail-open corpus omissions, and empty-hit cases become explicit verifier states instead of indistinguishable empty output.

## Inputs

- `src/index.ts` — current source of truth for provider/store composition and wiki contextual routing.
- `src/knowledge/retrieval.ts` — real retrieval boundary that must be exercised end to end.
- `T01-PLAN.md` — locked verifier contract and degraded-path expectations.

## Expected Output

- `src/knowledge/runtime.ts` — reusable production knowledge runtime factory.
- `src/knowledge/retriever-verifier.ts` — shared live verification logic over `createRetriever(...).retrieve(...)`.
- `scripts/retriever-verify.ts` — operator entrypoint for live retrieval verification.
- `package.json` — `verify:retriever` script alias.
