---
depends_on: [M035, M040, M041]
---

# M038: AST Call-Graph Impact Analysis — Context

**Gathered:** 2026-04-04
**Status:** Queued — pending auto-mode execution
**Depends on:** M035, M040, M041

## Project Description

Kodiai reviews code by reading diff text and retrieving related context via embedding similarity. It has no structural understanding of the codebase: it cannot tell the reviewer "this function is called by 15 callers in the auth path" or "this method change is a breaking API change because 3 other files depend on its current signature."

M038 surfaces that structural context in reviews — but it does NOT build the graph or the canonical corpus. M040 builds the persistent graph substrate. M041 builds the canonical current-code corpus. M038 is the review-time consumer that queries both to produce a structural impact section in Review Details.

## Why This Milestone

Structural context is the highest-ceiling improvement for review quality. Finding "this removes a null check" is useful; finding "this removes a null check in `parseToken()` which is called on every request in 12 API handlers" is actionable. The current diff-text + embedding-retrieval approach cannot surface this because embedding similarity finds semantically similar code, not structurally dependent code.

## Language Priority

**C++ and Python are first-class target languages.** These are the dominant languages in the Kodi codebase and the primary justification for building the graph and corpus substrates. M038's review-time surfaces must be demonstrated against C++ and Python PRs first.

TypeScript/JavaScript are **present but secondary** — they should work (via M040/M041 coverage), but are not the primary acceptance criteria for M038.

**Practical implication:** The acceptance tests and final integrated acceptance scenarios use C++ and/or Python PRs. Review Details showing structural impact for a C++ or Python function change is the milestone's proof of value. TypeScript/JavaScript parity is nice-to-have, not a release blocker.

## User-Visible Outcome

### When this milestone is complete, the user can:

- See a dedicated **Structural Impact** section in Review Details listing: which callers depend on changed C++ or Python functions, which files are in the blast radius, and how many callers existed before the change
- Trust that breaking-change detection for C++ and Python is structurally grounded (N callers found) rather than purely LLM heuristic

### Entry point / environment

- Entry point: PR review pipeline, pre-agent context enrichment stage in `src/handlers/review.ts`
- Environment: production
- Live dependencies involved: M040 graph substrate, M041 canonical corpus (both on existing Postgres stack), GitHub PR review flow

## Implementation Decisions

- **M038 is a consumer of M040 and M041, not a parallel path.** M038 queries M040's blast-radius graph and M041's canonical code corpus at review time. It does not run its own clone + analysis. Both substrate milestones must be complete before M038 is meaningful.
- **Language priority: C++ and Python first-class; TypeScript/JavaScript secondary.** M038's acceptance scenarios must demonstrate structural impact for C++ or Python PRs.
- **In-orchestrator consumer path.** Structural-impact queries run in the existing orchestrator review flow. No separate ACA Job and no standalone analysis service.
- **Structural Impact as a separate Review Details section, not inline in findings.** When M040/M041 produce usable evidence, it surfaces in a dedicated bounded section.
- **Block up to timeout, then fail-open.** Structural-impact orchestration waits up to the configured timeout before agent dispatch. If graph/corpus queries time out or fail, the review proceeds without structural context. Logs warn on any degradation.

## Agent's Discretion

- Exact section formatting in Review Details (heading, bullet structure, symbol name rendering)
- Cache key shape for graph queries (repo + base_sha + head_sha is the expected key)
- Whether a `buildStructuralImpactSection()` helper lives in `review-prompt.ts` or a new `structural-impact.ts` module

## Deferred Ideas

- Inline per-finding caller hints woven into individual findings — separate surface, future work
- Formal parity verification for TypeScript/JavaScript structural impact — follow-up after C++/Python are solid

## Completion Class

- Contract complete means: M040's graph and M041's corpus are queried at review time; structural impact data surfaces in a Review Details section for C++ and Python PRs; fail-open behavior verified
- Integration complete means: for a C++ or Python PR that changes a function, Review Details shows a Structural Impact section with at least the caller count and top affected files
- Operational complete means: graph/corpus query timeout/failure does not block review; logs expose degradation; second call for same commit reuses cached results

## Final Integrated Acceptance

- For a C++ PR that changes a widely-used function, Review Details shows a Structural Impact section identifying at least one known caller in the same repo
- For a Python PR that removes a function, Review Details states the function had N callers before the change
- Graph/corpus query failure or timeout does not prevent review from completing
- Second review call for the same commit reuses cached graph and corpus data

## Risks and Unknowns

- **Hard dependency on M040 and M041.** M038 cannot deliver its core value until both substrate milestones are complete and expose stable query APIs.
- **C++ structural resolution depth.** Tree-sitter gives structural AST, not full type resolution. For C++, call resolution is shallower than a compiler pass — macros and templates complicate it. The Review Details section must be honest ("probable callers" not "verified callers") where resolution is uncertain.
- **Blast-radius scope.** M040's graph produces a blast-radius set. M038 must bound what it sends to Review Details — a 500-file blast radius cannot be dumped whole.

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — pre-review context gathering; structural impact query runs here before agent dispatch
- `src/execution/review-prompt.ts` — prompt composition; `buildStructuralImpactSection()` slots in here
- `src/jobs/workspace.ts` — clone infrastructure already available
- M040 (queued, must complete first) — persistent graph substrate, blast-radius query API, C++/Python extraction
- M041 (queued, must complete first) — canonical current-code corpus, C++/Python chunking, semantic retrieval

## Relevant Requirements

- New scope — this milestone introduces structurally-grounded review context and blast-radius visibility in Review Details for C++ and Python codebases.

## Scope

### In Scope

- Query M040's graph substrate and M041's canonical corpus at review time to retrieve blast-radius data and relevant unchanged code for diff-touched symbols
- Build `buildStructuralImpactSection()` formatting caller counts, affected files, and blast-radius summary into a Review Details section
- Integrate into `src/handlers/review.ts` pre-agent dispatch with 30s timeout and fail-open fallback
- Primary target: C++ and Python; secondary: TypeScript/JavaScript (via M040/M041 coverage)
- Cache reuse: read from M040/M041 caches keyed by `(repo, base_sha, head_sha)`

### Out of Scope / Non-Goals

- Building the call graph or graph substrate (M040)
- Building the canonical code corpus (M041)
- Running a separate ACA Job for graph queries
- Inline per-finding caller hints
- Formal TypeScript/JavaScript structural impact verification in this milestone

## Technical Constraints

- M038 cannot start implementation until M040 and M041 expose stable query APIs
- Structural impact section must be bounded — no unbounded blast-radius dumps into the prompt
- Fail-open at every layer
- 30s timeout on graph/corpus queries before proceeding without structural context

## Integration Points

- `src/handlers/review.ts` — trigger graph/corpus query before agent dispatch; inject result if available within timeout
- `src/execution/review-prompt.ts` — `buildStructuralImpactSection()` for structural impact formatting
- M040 graph API — blast-radius query surface (confirm against M040's actual interface during M038 planning)
- M041 corpus API — semantic current-code retrieval surface (confirm against M041's actual interface during M038 planning)

## Open Questions

- **M040/M041 query interfaces** — exact APIs to be confirmed during M038 planning/research against the actual substrate interfaces shipped by those milestones
- **Bounded blast-radius ranking** — how many affected files/callers to include before truncating; decide during planning based on prompt budget and observed blast-radius sizes
