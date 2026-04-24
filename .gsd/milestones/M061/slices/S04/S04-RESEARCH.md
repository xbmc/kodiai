# S04 Research — Retrieval Reuse and Safe Derived-Context Caching

## Summary
S04 is a **targeted** slice. The repo already has the right primitives: a single shared retrieval seam (`src/knowledge/retrieval.ts`), deterministic/bounded variant generation (`src/knowledge/multi-query-retrieval.ts`), a stable fail-open cache utility with canonical key building (`src/lib/search-cache.ts`), and prompt builders that already return bounded `PromptBuildResult` objects with section telemetry (`src/execution/mention-context.ts`, `src/execution/review-prompt.ts`).

The missing work is not architectural invention; it is adding **truthful reuse at the existing seams**:
1. reuse query embeddings inside one retrieval run instead of regenerating the same embedding per corpus/query path
2. cache bounded **derived artifacts** (not raw mutable source state) behind explicit state fingerprints so identical mention/review state can reuse previously built prompt-context artifacts without serving stale data

## Requirement Targeting
Roadmap ownership for M061 says this slice covers the out-of-phase requirements:
- **R057** — reuse per-request query embeddings
- **R060** — truthful derived-context caches
- supports **R058/R059** by exposing reuse through the same canonical telemetry/proof seam rather than a side channel

`REQUIREMENTS.md` is still on the M052-M055 track, so planners/executors should follow the roadmap + milestone context, not the active requirement IDs in that file.

## Recommendation
Build S04 in this order:
1. **Retriever-local embedding reuse first** in `src/knowledge/retrieval.ts`
2. **Derived-context cache wrappers** for mention/review prompt-building seams using explicit fingerprints
3. **Provenance + tests** so reuse is visible and fail-open

This follows the AGENTS rules already visible in prior slices: use the lightest sufficient seam, fail open, and prove behavior through the canonical surfaces instead of inventing a new report path.

## Implementation Landscape

### 1) `src/knowledge/retrieval.ts` — primary S04 seam
This is the biggest token/cost waste today.

Current behavior inside `createRetriever().retrieve()`:
- builds up to 3 normalized variants from `opts.queries`
- calls `embeddingProvider.generate(variant.query, "query")` inside the learning-memory variant executor
- separately calls corpus helpers that each generate another query embedding for the same `intentQuery`:
  - review comments
  - wiki
  - code snippets
  - canonical code
  - issues

So one review/mention retrieval can produce **multiple redundant query embeddings** in the same request, even when the text is identical or normalized-equivalent.

Natural implementation seam:
- add a request-scoped embedding cache inside `retrieve()`
- key it by normalized query text + input type + provider identity/model
- expose a tiny helper like `getQueryEmbedding(query, provider)` and route all vector-search paths through it
- dedupe repeated query strings before embedding work, but preserve caller-visible behavior and ordering

Important: keep this **request-scoped/in-memory** for S04. The milestone wording says “same-query duplicate embedding work” and “safe derived-context caching”; it does not require a cross-process embedding store.

### 2) `src/knowledge/multi-query-retrieval.ts` — deterministic input normalization already exists
Useful facts:
- `buildRetrievalVariants()` already lowercases/normalizes/bounds inputs
- variant order is fixed: `intent`, `file-path`, `code-shape`
- tests already pin normalization behavior

Implication:
- do **not** invent a second normalization system for query reuse
- either reuse this normalized query output directly or factor a shared helper for the retriever’s embedding-cache key
- there is currently **no dedupe of identical variant query strings** after generation; that is easy/low-risk to add at the retriever seam

### 3) `src/lib/search-cache.ts` and `src/lib/in-memory-cache.ts` — existing cache pattern to copy
`search-cache.ts` already gives the exact behavior S04 wants at a small scale:
- stable JSON key construction with normalized query/repo/extra fields
- TTL
- in-flight coalescing (`getOrLoad`)
- fail-open error handling

`src/contributor/review-author-resolution.ts` is the best local example of how this repo wants truthful cache use:
- key includes repo + search type + query + extra params
- cache hit is surfaced explicitly
- cache faults fall back to direct execution
- degraded states suppress false hit reporting

Recommendation:
- prefer reusing `createSearchCache()` for derived-context caches unless a stricter bounded-value cache is needed
- use `buildSearchCacheKey()`-style stable keys for review/mention derived artifacts
- report cache hits/misses/degraded behavior explicitly rather than silently hiding recomputation

### 4) `src/handlers/mention.ts` + `src/execution/mention-context.ts` — mention-side derived artifact seam
Current shape:
- `handleMention()` builds `mentionContext` once via `buildMentionContextDetails()`
- that builder does real GitHub API reads and thread assembly
- then mention retrieval runs
- then `buildMentionPromptDetails()` / `buildReviewPromptDetails()` build final prompt text + section metrics

What is cacheable safely:
- **derived output**, not raw GitHub API payloads
- best candidate: the `PromptBuildResult` from `buildMentionContextDetails()`
- secondary candidate: final prompt build result when the exact admitted state is unchanged

Truthful fingerprint inputs for mention-context cache should include the state actually consumed by the builder, not just delivery id. At minimum:
- repo owner/name
- surface
- issue/pr number
- comment id
- comment created timestamp
- `inReplyToId`
- admission policy + caps (`maxThreadChars`, etc.)
- any parent/thread comment ids + `updated_at` values fetched during assembly
- PR metadata/body values if admitted
- finding metadata if `findingLookup` contributes to the output

Planner note: if that fingerprint becomes awkward inside the pure builder, put a small cache wrapper in `mention.ts` around the call site instead of pushing cache policy into the builder.

### 5) `src/handlers/review.ts` + `src/execution/review-prompt.ts` — review-side derived artifact seam
`buildReviewPromptDetails()` is already pure, deterministic, and bounded. It returns:
- prompt text
- named section metrics

That makes it a strong cache target.

There is already **ad hoc reuse** in the retry path: the reduced-scope retry reuses initial-run retrieval outputs, cluster matches, linked issues, and structural impact instead of recomputing them. S04 can turn that idea into an explicit cache/fingerprint pattern.

Truthful review-cache key inputs should include everything that changes prompt meaning, especially:
- repo/owner/pr number
- base/head branch names and ideally base/head SHAs
- changed file list (ordered/canonicalized)
- review profile knobs (`mode`, severity floor, focus/ignored areas, max comments, min confidence)
- custom instructions / checkpoint flag
- boundedness / large-PR / incremental context inputs
- retrieval-derived inputs fingerprint (unified result ids/text fingerprint or contextWindow fingerprint)
- linked issue ids / cluster pattern ids / structural impact / graph context fingerprint
- contributor experience contract + search degradation flags if they affect prompt wording

Because retry uses a smaller file set, a truthful key naturally misses there; that is correct.

## Natural Task Seams

### Task seam A — request-scoped embedding reuse
Files:
- `src/knowledge/retrieval.ts`
- maybe `src/knowledge/multi-query-retrieval.ts` if a shared normalization helper is extracted
- `src/knowledge/retrieval.test.ts`
- `src/knowledge/retrieval.e2e.test.ts`

Deliverable:
- one retrieval run embeds each unique normalized query/provider pair once
- all corpus vector searches consume that shared result
- fail-open preserved

### Task seam B — mention derived-context cache
Files:
- `src/handlers/mention.ts`
- possibly `src/execution/mention-context.ts`
- `src/handlers/mention.test.ts`
- `src/execution/mention-context.test.ts` only if key/fingerprint helpers live there

Deliverable:
- repeated identical mention state reuses bounded derived context/prompt artifact
- changed thread/PR/comment state misses cleanly
- no stale raw GitHub state is served when fingerprints drift

### Task seam C — review derived-context cache
Files:
- `src/handlers/review.ts`
- possibly `src/execution/review-prompt.ts`
- `src/handlers/review.test.ts`
- `src/execution/review-prompt.test.ts` if fingerprint helpers or cached result shapes are colocated

Deliverable:
- repeated identical review state reuses bounded prompt build artifact
- reduced-scope retry or head/state changes miss cleanly
- prompt section telemetry remains truthful on cache hits

### Task seam D — observability/proof surface
Likely files:
- `src/knowledge/retrieval.ts` types/provenance
- maybe `src/telemetry/types.ts` if a new bounded reuse signal is persisted
- `scripts/usage-report.ts` / verifier only if S04 exposes durable evidence now rather than waiting for S05

Deliverable:
- cache/embedding reuse visible through canonical surfaces, not logs only
- fail-open/degraded states distinguish “miss” from “cache unavailable”

## Risks / Constraints
- **Truthful keys matter more than hit rate.** Cache only bounded derived artifacts. Do not cache raw mutable GitHub API results behind weak keys.
- **Do not fork the telemetry surface.** S01-S03 established `prompt_section_events` + `usage-report`/verifier as canonical; S04 should extend or reuse that path.
- **Fail open on cache problems.** `search-cache.ts` and prior slices already set the project norm.
- **Keep caches local and boring.** Nothing in the current slice requires a DB-backed or cross-process cache.
- **Avoid keying on delivery id alone.** Duplicate webhook deliveries with identical state should hit; changed state under a new delivery should miss.

## Verification Plan
Minimum verification the planner should require:

### Retrieval reuse
- `bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts`
- add assertions on embedding-provider call count so repeated same-query paths prove reuse
- add a fail-open test where cache bookkeeping throws and retrieval still completes

### Mention derived-context cache
- `bun test src/handlers/mention.test.ts src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts`
- add one test proving identical mention state hits cache / builder runs once
- add one test proving changed thread/comment state misses
- add one test proving cache failure falls back to direct build

### Review derived-context cache
- `bun test src/handlers/review.test.ts src/execution/review-prompt.test.ts`
- add one test proving identical review state reuses prompt build result
- add one test proving reduced-scope retry or changed changed-files list misses
- add one test proving prompt-section metrics remain identical/truthful on hit vs miss

### Workspace-wide safety
- `bun run lint`

If S04 introduces operator-visible provenance or proof commands, reuse the established S01-S03 pattern and add a dedicated verifier script rather than a one-off debug script.

## Skill Discovery Notes
Relevant installed skills already present in this environment:
- `observability` — useful if S04 persists reuse evidence beyond in-memory provenance
- `best-practices` — useful if cache boundaries expand beyond the current slice

External skill suggestions found but **not necessary** unless execution broadens:
- `npx skills add supabase/agent-skills@supabase-postgres-best-practices` — only relevant if S04 adds Postgres-backed durable cache/reuse evidence now instead of deferring that proof to S05
- `npx skills add hookdeck/webhook-skills@github-webhooks` — low relevance; only useful if planners decide webhook delivery semantics need deeper treatment for duplicate-event cache truthfulness

## Concrete Planner Guidance
The safest plan is:
1. modify **retrieval** first; it is isolated and has the clearest measurable waste
2. reuse **existing cache primitives** (`search-cache.ts`) instead of inventing new cache infrastructure
3. add **small wrapper-level derived caches** in `mention.ts` and `review.ts`; only push helpers into execution modules if fingerprint logic becomes reusable
4. wire **explicit hit/miss/degraded signals** into whatever provenance/telemetry surface S04 chooses
5. finish with tests proving **same state hits, changed state misses, cache faults fail open**

Slice S04 should feel like S01-S03: compact code at the right seam, bounded evidence, no speculative framework work.
