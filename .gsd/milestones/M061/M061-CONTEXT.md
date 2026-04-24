# M061: Token Efficiency & Context Budgeting

**Gathered:** 2026-04-23
**Status:** Ready for planning

## Project Description

M061 is a token-efficiency and context-budgeting milestone for Kodiai’s main execution paths. The system already records aggregate execution and LLM-call telemetry in Postgres, but it still spends tokens eagerly in several places and lacks a truthful operator surface for attributing that spend by prompt path, prompt section, and cache effectiveness. This milestone establishes the measurement seams first, then uses them to drive prompt compaction and safe request-scoped reuse.

The work is deliberately staged. S01 repairs the baseline reporting and attribution surface so operators can inspect real Postgres-backed token, cache, and prompt-composition evidence instead of relying on stale SQLite-era scripts. Later slices then reduce token usage in mention flows, review prompts, and retrieval, using the new baseline to prove that compaction is real and truthful rather than cosmetic.

## Why This Milestone

Kodiai currently has the ingredients for better token efficiency — bounded context builders, task-type-aware telemetry, unified retrieval, and existing cache signals — but the product still lacks a coherent answer to a simple operator question: where did the tokens go, and did the extra context actually help? Without that baseline, optimization work risks becoming guesswork or, worse, adding caches that hide prompt bloat instead of removing it.

This milestone exists to make token usage attributable before it is optimized. It also keeps the repo aligned with an existing pattern: authoritative truth should come from the live Postgres schema and the production write path, not from sidecar scripts that read outdated local files or deprecated table names.

## User-Visible Outcome

### When this milestone is complete, the user can:

- inspect operator-visible token, cost, cache, and prompt-composition evidence for the main execution paths (`review.full`, conversational mention responses, explicit mention reviews, and Slack assistant flows)
- trust that mention and review prompts use staged loading and bounded sections rather than eager, duplicate context stuffing
- rely on retrieval and derived-context reuse only where the cache boundary is truthful and state-fingerprinted
- rerun a final proof surface that shows lower token spend on representative paths without regressing grounding, publish behavior, or fail-open semantics

### Entry point / environment

- Entry point: Kodiai review execution, mention execution, Slack assistant execution, and operator verification/report commands
- Environment: production-like Postgres-backed telemetry path plus deterministic verifier and unit-test coverage
- Live dependencies involved: Postgres telemetry tables, prompt builders, review/mention/slack handlers, retrieval pipeline, and operator reporting scripts

## Completion Class

- Contract complete means: the system has explicit, durable accounting for token/cost/cache behavior and prompt composition along the main execution paths
- Integration complete means: prompt builders, execution/runtime writes, retrieval/cache seams, and operator scripts all agree on the same telemetry truth source
- Operational complete means: operators can rerun a proof surface that attributes spend and confirms reductions without using stale SQLite-only tooling

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- operators can inspect durable Postgres-backed token/cost/cache evidence for representative review, mention, explicit mention-review, and Slack flows
- conversational mention and review prompts are materially smaller by default because they stage optional context instead of injecting it eagerly
- review prompt assembly enforces bounded section budgets and uses the compact unified retrieval context rather than duplicating larger context blocks
- retrieval reuses same-query embedding work and only serves derived caches when state fingerprints make that reuse truthful
- the final verifier shows measurable token reduction on representative paths without regressing correctness, grounding, publication, or fail-open behavior

## Scope

### In Scope

- Postgres-backed operator reporting and token accounting repair
- prompt-section accounting and prompt-path attribution
- staged mention-context loading
- bounded review prompt sections and compact unified retrieval context usage
- same-query embedding reuse and truthful derived-context caching
- final milestone proof of reduced token usage with correctness/regression checks

### Out of Scope / Non-Goals

- changing the public product contract of reviews or mentions beyond token-efficiency and truthfulness improvements
- adding caches that serve stale repo/thread/review state without explicit fingerprints
- preserving SQLite compatibility in the main reporting path
- optimizing by intuition alone without attributable evidence

## Architectural Decisions

### Postgres is the only authoritative reporting surface

**Decision:** M061 treats the live Postgres telemetry schema and shared DB client as the only authoritative reporting path.

**Rationale:** The production runtime already writes truth to Postgres. Preserving SQLite compatibility in the main operator surface would keep two conflicting truth sources alive.

**Evidence source:** S01 research plus existing `src/telemetry/store.ts` and `src/db/client.ts` usage.

**Alternatives Considered:**
- Keep SQLite compatibility in scripts — rejected because it preserves stale operator truth.
- Create a second ad hoc export/reporting store — rejected as duplication.

### Measure prompt composition at prompt-construction seams

**Decision:** Prompt-section accounting belongs near `buildMentionContext()`, `buildMentionPrompt()`, and `buildReviewPrompt()`, then flows through runtime telemetry.

**Rationale:** Once execution leaves the prompt-builder seam, section provenance is largely gone. Measuring only aggregate tokens at the end of the run cannot explain where prompt bloat came from.

**Evidence source:** S01 research and the deterministic section structure already present in prompt builders.

**Alternatives Considered:**
- End-of-run aggregate-only reporting — insufficient for section attribution.
- Raw prompt persistence — rejected on signal/noise and data-exposure grounds.

### Fail open on access or telemetry degradation, but report it explicitly

**Decision:** Operator scripts and verifiers must fail open when DB or other evidence surfaces are unavailable, while reporting `available|missing|unavailable` style access state explicitly.

**Rationale:** This repo already prefers truthful degraded reporting over hard crashes when live evidence is unavailable. Operators need to know whether evidence is absent because the system did not emit it or because the inspection surface is unavailable.

**Evidence source:** existing verifier patterns like `scripts/verify-m044-s01.ts`.

**Alternatives Considered:**
- Hard fail on all missing access — too brittle for operator use.
- Silent skip — hides the real problem.

### Optimize only behind truthful state boundaries

**Decision:** Request-scoped reuse and derived-context caching are acceptable only when repo/thread/head or equivalent state fingerprints make the reuse truthful.

**Rationale:** Token savings that serve stale context are regressions, not wins. This milestone values truthfulness over raw cache hit rate.

**Evidence source:** roadmap risk section and prior project decisions around fail-open/cache truthfulness.

**Alternatives Considered:**
- Opportunistic reuse without explicit state keys — rejected as unsafe.

## Error Handling Strategy

If the operator reporting surface cannot reach Postgres, it should surface that access failure explicitly and avoid claiming evidence it cannot inspect. If prompt-section attribution is unavailable for a path, the system should still preserve aggregate execution/cost data and report the attribution gap rather than fabricating section-level certainty.

If a cache or reuse seam cannot prove its state fingerprint matches, it must miss and recompute. If optimization work reduces tokens but regresses grounding, publication behavior, or fail-open semantics, the milestone is not complete even if the token count went down.

## Risks and Unknowns

- The largest waste may come from prompt assembly rather than cache misses, so cache work without prior attribution could preserve the wrong shape of prompt.
- Over-trimming mention or review context could make outputs less grounded or less truthful.
- Derived-context caches may drift stale unless state fingerprints are explicit and enforced.
- Existing smoke scripts and docs anchored to SQLite-era assumptions may hide how much reporting truth has actually diverged.

## Existing Codebase / Prior Art

- `src/telemetry/store.ts` and `src/telemetry/types.ts` — current Postgres-backed telemetry contract and write path
- `src/llm/cost-tracker.ts` and `src/llm/generate.ts` — per-call usage/cost aggregation seams
- `src/execution/mention-context.ts` and `src/execution/mention-prompt.ts` — bounded mention context/prompt seams
- `src/execution/review-prompt.ts` — large structured review prompt with clear section seams
- `scripts/usage-report.ts`, `scripts/phase72-telemetry-follow-through.ts`, `scripts/phase75-live-ops-verification-closure.ts` — stale operator surfaces that still assume SQLite/`executions`
- `scripts/verify-m044-s01.ts` — good model for Postgres-backed preflight and truthful access-state reporting

## Relevant Requirements

Per the M061 roadmap ownership map, this milestone covers:

- R056 — staged context over eager injection
- R057 — reuse per-request query embeddings
- R058 — token/cache telemetry attribution
- R059 — bounded compact review prompt assembly
- R060 — truthful derived-context caches

Note: the current `REQUIREMENTS.md` active section is out of phase with M061 and still centers later large-PR requirements. Planning and execution for this milestone should trust the roadmap’s ownership map until requirements state is reconciled.

## Technical Constraints

- The main reporting path must be Postgres-backed, not SQLite-backed.
- Prompt accounting should store bounded metrics and labels, not raw prompt bodies.
- `telemetry_events` alone does not currently distinguish all user-facing task paths; task-path attribution may need to rely on `llm_cost_events.task_type` and new durable prompt-accounting records.
- Any cache introduced in this milestone must miss on state drift rather than serve stale context.

## Integration Points

- review, mention, and Slack execution handlers
- prompt builders and runtime result plumbing
- telemetry storage and migrations
- retrieval/query fan-out and any request-scoped reuse layer
- operator scripts, smoke docs, and milestone verification surfaces

## Testing Requirements

This milestone needs a mix of contract tests, integration-oriented tests, and operator proof surfaces:

- telemetry store and migration coverage for any new durable prompt-accounting records
- prompt-builder tests that prove named section accounting is deterministic and bounded
- script/verifier tests that prove the repaired reporting path reads the live Postgres schema and reports access-state truthfully
- later slice tests that prove staged loading, bounded sections, reuse, and invalidation semantics
- final milestone verification that shows lower token usage on representative paths without correctness regression

## Acceptance Criteria

- The stale SQLite-only operator reporting path is replaced by a truthful Postgres-backed surface.
- Prompt-section accounting is durable enough to explain where prompt tokens go by path and section.
- Mention and review prompt compaction is proven with the new accounting seams rather than inferred from prose.
- Retrieval reuse and derived-context caching are bounded by truthful state fingerprints.
- The final milestone proof shows meaningful token reduction and preserves grounding, publication, and fail-open behavior.

## Open Questions

- Should prompt-section accounting live in a dedicated prompt-accounting table or be attached to existing LLM cost events via a companion record?
- Which final representative paths best show token reduction while still exercising explicit mention reviews and Slack assistant behavior?
- How compact can review prompt sections become before quality starts to regress on larger or more ambiguous PRs?
