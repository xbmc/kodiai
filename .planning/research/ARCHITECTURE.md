# Architecture Research

**Domain:** Incremental AI code review architecture (embeddings-assisted learning + re-review + multi-language support)
**Researched:** 2026-02-12
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Ingress + Orchestration Layer                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│  [Hono Webhook] -> [Verify+Dedup] -> [Event Router] -> [Review Handler]    │
│                                                  \-> [Feedback Sync Handler] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Review Intelligence Layer                                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│  [Diff Analysis] -> [Language Profiler] -> [Re-review Delta Planner]        │
│         \                \                    /                              │
│          \-> [Embedding Retrieval] <- [Learning Indexer Worker]             │
│                            |                                                 │
│                     [Review Prompt Builder] -> [Executor]                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Persistence Layer                                                             │
│  [knowledge.db] [telemetry.db] [embedding vectors/metadata tables]          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Review Handler | Keep deterministic review lifecycle, now enriched with language + retrieval + re-review context | Extend `src/handlers/review.ts` with optional gated context assembly |
| Learning Indexer Worker | Build/update embeddings and review-memory records asynchronously, never blocking review publication | New queued job path reusing `jobQueue.enqueue(..., { jobType })` |
| Embedding Retrieval | Pull top-K historical patterns/snippets for current diff with deterministic ranking | New retrieval service over SQLite tables + deterministic tie-break sort |
| Re-review Delta Planner | Convert prior findings + current patch into "needs re-check"/"already touched" sets | New deterministic mapper using file path + line range + title fingerprint |
| Language Profiler | Detect dominant + secondary languages per PR and per changed file | Extension map + shebang parser + conservative fallback |

## Recommended Project Structure

```
src/
├── learning/                         # NEW: embeddings and review-memory pipeline
│   ├── embedding-provider.ts         # provider interface + adapter(s)
│   ├── chunker.ts                    # deterministic chunking for files/findings
│   ├── indexer.ts                    # upsert vectors/metadata (async worker path)
│   ├── retrieval.ts                  # top-K similar memories for prompt enrichment
│   └── rereview-delta.ts             # incremental re-review planner
├── language/                         # NEW: multi-language profiling
│   ├── profiler.ts                   # file->language and PR language mix
│   └── normalization.ts              # canonical language ids for prompts/storage
├── handlers/
│   ├── review.ts                     # MODIFIED: integrate all new context builders
│   └── feedback-sync.ts              # MODIFIED: emit learning update signals
├── execution/
│   ├── review-prompt.ts              # MODIFIED: sections for memory/delta/language
│   └── config.ts                     # MODIFIED: feature flags + budgets + privacy knobs
├── knowledge/
│   ├── store.ts                      # MODIFIED: vector metadata + rereview tracking tables
│   └── types.ts                      # MODIFIED: new records (embedding docs, reruns)
└── index.ts                          # MODIFIED: wire new services and async jobs
```

### Structure Rationale

- **`learning/`:** isolate experimental/high-growth logic away from stable webhook/executor control flow.
- **`language/`:** keep language concerns deterministic and reusable by prompt build and storage tags.
- **`handlers/review.ts`:** remains orchestration entrypoint; new capabilities are pluggable helpers, not inlined logic.

## Architectural Patterns

### Pattern 1: Deterministic Context Enrichment Pipeline

**What:** Build review context in fixed order: diff -> language -> re-review delta -> embeddings retrieval -> prompt.
**When to use:** Every PR review execution.
**Trade-offs:** Predictable behavior and testability, but strict ordering means less room for opportunistic heuristics.

**Example:**
```typescript
const diff = analyzeDiff(...);
const languageProfile = profileLanguages(changedFiles);
const deltaPlan = buildRereviewDelta({ repo, prNumber, changedFiles, patchMap, knowledgeStore });
const memories = retrievalEnabled
  ? retrieveLearningContext({ repo, changedFiles, languageProfile, deltaPlan, topK: 12 })
  : [];

const prompt = buildReviewPrompt({ ...base, diffAnalysis: diff, languageProfile, deltaPlan, memories });
```

### Pattern 2: Async Learning Writes, Sync Learning Reads

**What:** Review path only reads bounded context; expensive embedding generation runs after review in non-fatal async jobs.
**When to use:** Any learning step with external latency (embedding model call, backfill).
**Trade-offs:** No regression to review SLA; learning freshness becomes eventually consistent.

**Example:**
```typescript
// in review success path
jobQueue.enqueue(event.installationId, async () => {
  await learningIndexer.upsertFromReview({ reviewId, repo, findings, changedFiles });
}, { jobType: "learning-index" });
```

### Pattern 3: Feature-Flagged Progressive Activation

**What:** Add config gates per capability: `knowledge.embeddings.enabled`, `review.incrementalRereview.enabled`, `review.languageAwareness.enabled`.
**When to use:** Milestone rollout where stability > capability breadth.
**Trade-offs:** Slight config complexity, major rollback safety.

## Data Flow

### Request Flow

```
[pull_request.* webhook]
    ↓
[Review Handler]
    ↓
[Deterministic Preprocessing]
    -> analyzeDiff
    -> profileLanguages
    -> buildRereviewDelta
    -> retrieveLearningContext (bounded, optional)
    ↓
[buildReviewPrompt]
    ↓
[Executor -> MCP publish]
    ↓
[Post-processing]
    -> record review/findings (existing)
    -> enqueue learning index update (new, non-fatal)
```

### State Management

```
[knowledge.store]
    ↓ (read)
[Review Handler Context Assembly]
    ↓ (write after completion, async)
[Learning Indexer]
    ↓
[embedding_* + rereview_* tables]
```

### Key Data Flows

1. **Embeddings-assisted learning:** new findings and historical accepted/rejected signals become chunks -> embeddings -> vector metadata rows -> retrieved into future prompts.
2. **Incremental re-review:** prior findings + current patch map produce targeted "re-check these areas" context; unchanged prior findings are deprioritized.
3. **Multi-language analysis:** changed files map to canonical languages; prompt focus and finding categorization get language-aware hints (framework idioms, test conventions, false-positive guardrails).

## New vs Modified Components (Explicit)

### New Components

| Component | Integration Point | Purpose |
|----------|--------------------|---------|
| `src/learning/embedding-provider.ts` | Called by `learning/indexer.ts` | Standard API for embedding model(s), supports provider swap without touching handlers |
| `src/learning/chunker.ts` | Called by `learning/indexer.ts` | Deterministic chunk IDs for file/finding text (stable hashing) |
| `src/learning/indexer.ts` | Enqueued from `handlers/review.ts` and `handlers/feedback-sync.ts` | Async generation/upsert of embeddings and learning metadata |
| `src/learning/retrieval.ts` | Called by `handlers/review.ts` pre-prompt | Bounded top-K retrieval + ranking merge (semantic + recency + confidence) |
| `src/learning/rereview-delta.ts` | Called by `handlers/review.ts` pre-prompt | Maps historical findings to changed hunks for incremental re-review |
| `src/language/profiler.ts` | Called by `handlers/review.ts` pre-prompt | PR language distribution and dominant-language detection |
| `src/language/normalization.ts` | Used by profiler/retrieval/store | Canonical language enums (e.g., `ts`, `tsx`, `python`, `go`) |

### Modified Components

| Component | File/Module | Required Change |
|----------|-------------|-----------------|
| Review orchestration | `src/handlers/review.ts` | Add deterministic context assembly step and async index job dispatch; keep publish path unchanged |
| Prompt assembly | `src/execution/review-prompt.ts` | Add three optional sections: `Learning Context`, `Incremental Re-review Focus`, `Language-Specific Guidance` with hard char caps |
| Config schema | `src/execution/config.ts` | Add feature flags, token/char budgets, privacy mode (repo-only/global opt-in), embedding provider config |
| Knowledge schema/API | `src/knowledge/store.ts`, `src/knowledge/types.ts` | Add tables + methods for embedding docs, retrieval traces, rereview state snapshots |
| Feedback ingestion | `src/handlers/feedback-sync.ts` | Convert thumbs up/down to learning weights and enqueue index refresh |
| App wiring | `src/index.ts` | Instantiate learning/language services and inject into handlers |

## Concrete Data Model Additions (SQLite)

- `embedding_documents` (doc metadata): `id`, `repo`, `source_type`, `source_ref`, `language`, `text_hash`, `created_at`.
- `embedding_vectors` (vector blobs or extension-backed vectors): `document_id`, `model`, `dimensions`, `vector`, `updated_at`.
- `rereview_snapshots`: `repo`, `pr_number`, `review_id`, `finding_fingerprint`, `file_path`, `start_line`, `end_line`, `status`.
- `retrieval_events`: audit/observability for retrieved memory IDs, score, latency, prompt budget consumption.

Recommendation: if SQLite vector extension is unavailable in runtime, ship lexical fallback in `retrieval.ts` (title/path/category weighted search) and keep the same API shape.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Single-process Bun + SQLite WAL remains sufficient; enable embeddings in repo-scoped mode only |
| 1k-100k users | Move embedding generation to dedicated worker process; keep webhook/review path read-only for learning |
| 100k+ users | Externalize vector search and queue backend; keep deterministic prompt contract unchanged |

### Scaling Priorities

1. **First bottleneck:** embedding generation latency/cost; solve with async worker, batching, and strict per-review retrieval budgets.
2. **Second bottleneck:** knowledge DB growth; solve with dedup by `text_hash`, compaction, and optional retention windows for low-value traces.

## Anti-Patterns

### Anti-Pattern 1: Inline Embedding Calls in Critical Review Path

**What people do:** call embedding API inside `handleReview` before executor run.
**Why it's wrong:** adds unpredictable latency/failure modes to webhook-driven review SLA.
**Do this instead:** only retrieve existing embeddings synchronously; generate/update embeddings asynchronously post-review.

### Anti-Pattern 2: Unbounded Memory Injection into Prompt

**What people do:** append all historical findings or multilingual hints to prompt.
**Why it's wrong:** prompt bloat increases cost, decreases determinism, and can reduce review quality.
**Do this instead:** hard cap by `topK`, total chars, and deterministic ranking with stable tie-breakers.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Embedding model provider | Adapter in `learning/embedding-provider.ts` with timeout + retry budget | Must be optional and non-blocking for review publication |
| GitHub APIs (existing) | Continue Octokit usage in handlers and MCP servers | No new webhook type required for MVP; reuse current events |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `handlers/review.ts` <-> `learning/retrieval.ts` | Direct function call | Read-only, bounded response, deterministic sort |
| `handlers/review.ts` <-> `learning/indexer.ts` | Queue job dispatch | Write-heavy path isolated from review critical path |
| `handlers/review.ts` <-> `language/profiler.ts` | Direct function call | Pure deterministic function, easy unit-test surface |
| `feedback-sync.ts` <-> `learning/indexer.ts` | Queue job dispatch | Enables reinforcement updates from reaction signals |

## Cross-Cutting Concerns

- **Latency:** retrieval must have strict timeout (e.g., 40-80ms budget) and fail-open to empty context.
- **Storage Growth:** vectors and retrieval traces can outgrow current DB assumptions; require dedup, compaction job, and optional retention for low-signal artifacts.
- **Privacy:** default repo-scoped learning only; cross-repo sharing remains explicit opt-in (`knowledge.shareGlobal`) and excludes raw code snippets in shared aggregates.
- **Observability:** add stage-level metrics and logs (`rereview_delta_ms`, `retrieval_ms`, `retrieved_docs`, `language_mix`, `index_job_ms`) with `deliveryId` correlation.

## Safe Build Order (Minimize Regression Risk)

1. **Schema + Types First (no behavior change):** extend `knowledge/types.ts` and `knowledge/store.ts` with new tables/methods behind unused APIs.
2. **Pure Deterministic Helpers:** add `language/profiler.ts` and `learning/rereview-delta.ts` with unit tests only; no handler wiring yet.
3. **Prompt Surface Expansion (gated off):** modify `execution/review-prompt.ts` to accept optional new sections; default empty keeps current output.
4. **Read-Only Wiring in Review Handler:** integrate profiler + delta into `handlers/review.ts` behind config flags, with fail-open behavior.
5. **Retrieval Layer (fallback-first):** ship `learning/retrieval.ts` with lexical fallback; only then enable embedding-backed retrieval if extension/provider present.
6. **Async Indexer + Feedback Reinforcement:** wire `learning/indexer.ts` enqueue from review and feedback handlers; keep non-fatal and separately observable.
7. **Progressive Rollout:** enable per repo with low limits (`topK`, chars, timeouts), monitor telemetry/knowledge impact, then expand.

## Sources

- Codebase: `src/handlers/review.ts`, `src/execution/review-prompt.ts`, `src/execution/config.ts`, `src/knowledge/store.ts`, `src/handlers/feedback-sync.ts`, `src/index.ts` (HIGH).
- Bun SQLite docs (official): https://bun.com/docs/runtime/sqlite (verified `WAL` and `.loadExtension()`, accessed 2026-02-12, HIGH).
- SQLite WAL docs (official): https://www.sqlite.org/wal.html (HIGH).

---
*Architecture research for: Kodiai v0.5 Advanced Learning & Language Support*
*Researched: 2026-02-12*
