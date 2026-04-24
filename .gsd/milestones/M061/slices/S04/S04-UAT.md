# S04: S04 — UAT

**Milestone:** M061
**Written:** 2026-04-24T03:14:26.295Z

# UAT — S04 Retrieval Reuse and Safe Derived-Context Caching

## Preconditions
- Repository is at the S04-complete code state.
- Bun dependencies are installed.
- No live Postgres instance is required for the degraded-path proof; if Postgres is available, operator-visible reuse rows can also be inspected through the same verifier/report surfaces.

## Test Case 1 — Retrieval reuses duplicate same-query embeddings within one request
1. Run `bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts`.
2. Confirm the suite passes.
3. Inspect the tests covering duplicate normalized queries and per-request boundaries.
4. Expected outcome: identical normalized retrieval variants reuse one embedding request per normalized query/provider/input-type pair, null or malformed embeddings stay fail-open, and caller-visible retrieval ordering remains unchanged.

## Test Case 2 — Mention derived-context cache hits only for identical admitted state
1. Run `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts`.
2. Confirm the suite passes.
3. Verify the mention derived-context cache tests cover both identical-state reuse and fingerprint drift.
4. Expected outcome: identical mention state produces a cache hit with stable prompt content, but changes to admitted comment/thread/PR metadata or policy knobs force a miss/rebuild. Cache bookkeeping failures degrade to direct rebuild and remain observable.

## Test Case 3 — Review prompt artifact cache misses on retry scope or PR state drift
1. Run `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts`.
2. Confirm the suite passes.
3. Inspect the review derived-cache tests for identical-state hit, state-drift miss, and reduced-scope retry miss.
4. Expected outcome: unchanged review state reuses the bounded prompt artifact, but changed head/base/file set, changed review knobs, or reduced-scope retry state misses naturally and rebuilds. Published review behavior and prompt-section telemetry stay truthful.

## Test Case 4 — Canonical reporting surfaces expose reuse or explicit degraded state
1. Run `bun test scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts`.
2. Run `bun scripts/verify-m061-s04.ts --json`.
3. If Postgres is unavailable, verify the JSON reports `databaseAccess: unavailable` and `statusCode: telemetry_unavailable` instead of silently passing.
4. If Postgres is available with relevant telemetry rows, verify the JSON includes explicit reuse evidence for retrieval embedding reuse and mention/review derived-cache states.
5. Expected outcome: operators get one canonical proof surface for S04 reuse evidence, and degraded DB access is explicit and fail-open.

## Test Case 5 — Lint and integration guardrail
1. Run `bun run lint`.
2. Expected outcome: lint passes with no new issues from retrieval memoization, mention/review cache wrappers, or usage-report/verifier additions.

## Edge Cases
- Duplicate queries that differ only by whitespace/casing still collapse to one embedding request inside a single retrieval run.
- Missing fingerprint inputs must not produce a weak cache hit; the system should bypass cache and rebuild.
- Cache corruption/bookkeeping exceptions must not block mention or review execution; they should surface as degraded/bypass states.
- Reduced-scope review retries must miss automatically when their file scope or retry instructions differ from the original request.
- Live telemetry unavailability must be reported as degraded proof input, not mistaken for successful evidence of reuse.
