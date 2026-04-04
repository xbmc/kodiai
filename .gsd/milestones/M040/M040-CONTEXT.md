# M040: Graph-Backed Extensive Review Context

**Gathered:** 2026-04-04
**Status:** Queued — pending auto-mode execution

## Project Description

Kodiai already has a strong review pipeline for normal-sized PRs: large-PR triage, cross-corpus retrieval, hybrid vector + BM25 search, RRF merging, prompt context windows, review precedents, and cluster-pattern hints. What it does not have is a **persistent structural graph** of the repository that can answer questions like:

- which callers and dependents are in the blast radius of this change?
- which tests are most likely to validate the changed code?
- which files should be reviewed deeply versus mentioned only?
- how can we prune context for monorepos and very large PRs without losing true impact?

`code-review-graph` demonstrates a strong approach here: Tree-sitter-backed structural indexing, incremental updates, blast-radius analysis, and token-efficient review context assembly. `octopusreview/octopus` adds complementary pipeline ideas: retrieval + rerank + second-pass validation to keep findings precise. Kodiai should adopt the useful parts of both approaches, but on its existing Bun/Postgres/pgvector stack rather than by adding a separate local graph store.

## Why This Milestone

This is a meaningful expansion of Kodiai's review capability for **extensive code review** — especially large PRs, monorepos, and structurally-coupled changes. It is only **partially** covered by M038. M038 is currently scoped as AST/call-graph impact analysis for review-time structural context; M040 is broader and earlier:

- **M040** = persistent graph substrate + blast-radius context selection + affected-test context + extensive-review pruning + optional second-pass validation
- **M038** = later consumer milestone for AST-backed review-time impact analysis, narrowed to build on the substrate produced here

## Language Priority

**C++ and Python are first-class target languages.** These are the dominant languages in the Kodi codebase. Tree-sitter grammars for both are mature and actively maintained (`tree-sitter-cpp` v0.23.4, `tree-sitter-python`). The graph substrate, query design, extraction queries, and verification fixtures must all be tuned for C++ and Python first.

TypeScript/JavaScript are **present but secondary** — they should work (Tree-sitter grammars exist), but are not the primary tuning target for call graph extraction, blast-radius accuracy, or fixture coverage.

**Practical implication:** Any language-specific extraction query (function/method detection, call site detection, import/include tracking, test file identification) must be written and tested for C++ and Python first. TypeScript/JavaScript queries can be added but are not acceptance blockers.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Get deeper review coverage on large C++ and Python PRs because Kodiai narrows review context to impacted files/functions/tests instead of relying only on file-level heuristics and semantic retrieval
- See structurally-grounded review context for changed code (blast radius, likely affected tests, dependent files) while keeping token usage bounded on large repos

### Entry point / environment

- Entry point: PR review flow (`src/handlers/review.ts`) with graph-aware context assembly before agent execution
- Environment: production
- Live dependencies involved: GitHub PR review flow, existing Postgres/pgvector stack, repository workspace clone, Tree-sitter grammars (C++, Python, optionally TS/JS)

## Completion Class

- Contract complete means: Kodiai can build and incrementally update a persistent structural graph for C++ and Python (and TS/JS as secondary), query blast radius from changed files/symbols, and feed graph-derived review context into the prompt assembly path
- Integration complete means: for large/extensive C++ or Python PRs, Kodiai uses graph-derived impacted files/tests/dependents to improve deep-review selection and context quality
- Operational complete means: graph updates are incremental and bounded; single-file/small PRs do not become slower or more expensive today; graph failures are fail-open

## Final Integrated Acceptance

- On a production-like large C++ or Python PR, Kodiai reviews a smaller but better-targeted context set using graph-derived blast radius while still surfacing the truly impacted callers/dependents/tests
- On a structurally-coupled C++ change (e.g. removing a widely-used function), Kodiai identifies affected files or tests that file-level risk triage alone would not have selected
- The graph path does not regress small PRs: trivial single-file changes either bypass graph overhead or stay within an acceptable bounded budget

## Risks and Unknowns

- **Precision vs recall trade-off** — `code-review-graph` reports perfect recall but modest precision/F1. Kodiai cannot flood review context with over-predicted files, so the graph output needs a bounded, review-oriented ranking layer
- **Single-file PR overhead** — graph metadata can cost more than simply reading the changed file on trivial changes. The milestone needs a bypass threshold so simple PRs stay cheap
- **C++ call resolution depth** — C++ macros, templates, and preprocessor directives mean tree-sitter call detection is shallower than a full compiler pass. Use tree-sitter for structural extraction and be honest in the output about confidence (e.g. "probable callers" not "verified callers")
- **Test-mapping quality** — linking changed symbols to relevant tests is valuable, but indirect or naming-based heuristics can be noisy without clear confidence scoring
- **Overlap with M038** — M040 must become the earlier base layer; M038 should consume this substrate rather than implementing a parallel AST path

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — verified large-PR triage already exists: `computeFileRiskScores()` → `triageFilesByRisk()` → prompt file reduction for full/abbreviated/mention-only sets
- `src/lib/file-risk-scorer.ts` — verified current extensive-review strategy is file-level risk slicing only; no graph/blast-radius input today
- `src/execution/review-prompt.ts` — verified prompt builder already accepts large-PR context, unified retrieval context, review precedents, cluster patterns, and linked issues; graph-derived context can slot into the existing composition model
- `src/knowledge/retrieval.ts` — verified Kodiai already has hybrid retrieval (vector + BM25), per-corpus hybrid merge, and cross-corpus RRF; M040 should complement this rather than replace it
- External reference: `tirth8205/code-review-graph` README — structural graph, incremental updates, blast-radius analysis, affected flow/test context, and token-efficiency framing
- External reference: Octopus architecture article — hybrid retrieval + rerank + semantic feedback suppression + optional second-pass validation

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- New scope — this milestone introduces graph-backed extensive-review coverage and structural context selection beyond today's file-level triage

## Scope

### In Scope

- Build a persistent structural graph on Kodiai's existing stack
- Use Tree-sitter-backed structural extraction for **C++ and Python (primary)** and TypeScript/JavaScript (secondary); extraction queries tuned and verified for C++ and Python first
- Incremental graph updates keyed off changed files / workspace diffs
- Graph queries for blast radius: changed files/symbols → affected files, callers/dependents, and likely tests
- Graph-aware extensive-review selection: use blast-radius ranking to augment or partially replace today's file-level large-PR triage
- Prompt integration: add graph-derived review context in a bounded section for impacted files/tests/dependency chains
- Optional second-pass validation for graph-amplified findings to reduce false positives
- Deterministic verification fixtures written for C++ and/or Python repos

### Out of Scope / Non-Goals

- Replacing the existing cross-corpus retrieval stack
- Building a canonical HEAD code-embedding corpus (that is M041)
- Full IDE/MCP graph tooling parity with `code-review-graph`
- Architecture visualization, wiki generation, community detection
- Replacing M038; this establishes the substrate M038 consumes
- Tuning TypeScript/JavaScript extraction to the same depth as C++ and Python in this milestone

## Technical Constraints

- Must reuse Kodiai's existing runtime/storage stack
- Must be fail-open: graph build/query failure cannot block PR reviews
- Must include a small-PR bypass so trivial changes do not pay graph overhead
- Must keep graph-derived context bounded and ranked; blast radius cannot be dumped wholesale into the prompt
- Extraction queries for C++ and Python must be written and verified before TS/JS is accepted as a blocker for milestone completion

## Integration Points

- `src/handlers/review.ts` — graph-aware extensive-review selection and context assembly before executor dispatch
- `src/lib/file-risk-scorer.ts` — extend current file-level large-PR triage with graph-derived blast-radius/test signals
- `src/execution/review-prompt.ts` — new bounded graph context section for impacted files/tests/dependency chains
- `src/jobs/workspace.ts` — graph build/update needs repository contents from the existing workspace model
- `src/db/migrations/` — new graph tables/artifacts and incremental-update bookkeeping

## Open Questions

- **Validation default** — should second-pass validation run only on graph-amplified major/critical findings, or on all graph-amplified findings?
- **C++ include resolution** — `#include` chains add depth but also noise; should include edges be in the blast-radius graph or only direct call edges?
