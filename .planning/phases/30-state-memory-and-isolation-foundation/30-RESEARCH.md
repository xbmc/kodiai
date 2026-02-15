# Phase 30: State, Memory, and Isolation Foundation - Research

**Researched:** 2026-02-12
**Domain:** Immutable run identity, embedding-backed learning memory (SQLite + vector search), repo-scoped isolation
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Run identity design:**
- Identity determination: Claude decides based on idempotency and debugging needs (SHA pair vs delivery ID vs request context)
- Force-push handling: Old review marked as superseded when head SHA changes - keeps obsolete review in audit trail but flags it clearly
- Requester impact: Claude decides whether requester identity matters for run uniqueness based on common use cases
- Observability: Run identity exposed in logs only, not in user-facing review comments (minimize noise)

**Embedding storage approach:**
- Storage backend: SQLite with vector extension (sqlite-vss or similar) for vector similarity search in same database
- Embedding model: Voyage AI with migration support - allow model version upgrades with background re-embedding of old memories
- Embedding content: Finding text + metadata (severity, category, file path enriched as context)
- Failure handling: Fail-open - review publishes without memory if embedding generation fails, logged but doesn't block publication

**Isolation boundaries:**
- Default isolation: Owner-level sharing opt-in - repos can participate in shared learning pool scoped to same GitHub owner/org
- Sharing configuration: Claude decides between config flag, allowlist, or admin API based on UX simplicity and control granularity
- Opt-out behavior: Immediate isolation when repo opts out - memory stops flowing to/from shared pool, but past contributions remain in pool
- Retrieval provenance: Yes - full provenance logged showing which repos contributed to each suggestion (for debugging and trust)

**Idempotency guarantees:**
- Enforcement layer: At ingestion - check run identity on webhook receipt, skip processing if already seen
- Duplicate handling: Claude decides between silent skip, logged skip, or tracking comment reaction based on debugging value vs noise
- State persistence: Claude decides retention duration based on storage cost vs reliability (PR duration, fixed window, or forever)
- Re-request bypass: Claude decides whether manual re-requests bypass idempotency based on UX expectations vs cost control

### Claude's Discretion

- Exact run identity composition (SHA pair, delivery ID, requester, timestamp combinations)
- SQLite vector extension choice (sqlite-vss, sqlite-vec, or other)
- Schema design for run state, memory records, and embedding storage
- Background migration strategy for embedding model version upgrades
- Shared pool querying and filtering algorithms
- Idempotency cache implementation (in-memory, database, or both)
- Duplicate webhook notification strategy
- Manual re-request bypass heuristics

### Deferred Ideas (OUT OF SCOPE)

None - discussion stayed within phase scope.
</user_constraints>

## Summary

Phase 30 establishes three foundational contracts: (1) immutable run identity for idempotent webhook processing, (2) embedding-backed learning memory storage with vector similarity search, and (3) repo-scoped isolation with opt-in owner-level sharing. The existing codebase already has a solid SQLite knowledge store (`src/knowledge/store.ts`) with WAL mode, a basic in-memory deduplicator (`src/webhook/dedup.ts`), and a review output idempotency check (`src/handlers/review-idempotency.ts`) that scans GitHub comments for markers. Phase 30 upgrades these to durable, SHA-keyed run state and adds the embedding infrastructure.

The key technical decisions are well-supported by the ecosystem. **sqlite-vec** (v0.1.6 stable, v0.1.7-alpha.2 latest) is the clear choice for the vector extension -- it is the successor to sqlite-vss by the same author, written in pure C with no dependencies, and has explicit Bun support via an npm `load()` function. It supports metadata columns, partition keys, and KNN queries with WHERE-clause filtering since v0.1.6. For embeddings, the **Voyage AI TypeScript SDK** (`voyageai` npm v0.1.0) provides a typed client with automatic retries and abort signal support, and the **voyage-code-3** model is purpose-built for code retrieval at $0.18/1M tokens with 200M free tokens per account.

The main architectural challenge is keeping the learning memory write path fully async and fail-open while making the read path bounded and fast. The run identity design must be durable (surviving process restarts) while the idempotency check must be fast (avoiding unnecessary GitHub API calls that the current marker-scan approach requires). The isolation model is straightforward in SQLite: partition by `repo` column for default isolation, with a separate shared pool table for opted-in repos filtered by `owner`.

**Primary recommendation:** Use sqlite-vec v0.1.6+ with metadata columns and partition keys for repo-scoped vector storage, the `voyageai` TypeScript SDK for embedding generation, and a SQLite-backed run state table replacing the in-memory deduplicator for durable idempotency.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sqlite-vec` | `0.1.6` (stable) or `0.1.7-alpha.2` | Vector similarity search in SQLite via vec0 virtual table | Pure C, no dependencies, explicit Bun support via `sqliteVec.load(db)`, metadata columns + partition keys for repo filtering |
| `voyageai` | `0.1.0` | Voyage AI TypeScript SDK for embedding generation | Official SDK with typed requests/responses, auto-retries, abort signal, Bun 1.0+ compatible |
| `bun:sqlite` | builtin (Bun runtime) | Host all persistent state (run table, knowledge, embeddings) | Already used for knowledge store; WAL mode, prepared statements, transactions |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | `4.3.6` (existing) | Schema validation for new config sections and API responses | Validate embedding config, sharing config, run identity composition |
| `pino` | `10.3.0` (existing) | Structured logging for run identity, provenance, fail-open events | Already in use; extend with new log fields for run ID correlation |
| `p-queue` | `9.1.0` (existing) | Async job queue for background re-embedding | Reuse existing queue pattern for non-blocking embedding generation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sqlite-vec npm `load()` | `db.loadExtension()` with compiled binary | npm `load()` handles platform detection automatically; `loadExtension()` requires manual binary path management |
| sqlite-vec (brute-force) | Hosted vector DB (Pinecone, Qdrant) | sqlite-vec is sufficient for corpus sizes expected in v0.5 (<100K vectors); external DB adds operational burden |
| Voyage AI SDK | Raw `fetch` to Voyage API | SDK handles retries, error types, AbortSignal natively; minimal dependency footprint for significant ergonomic gain |
| voyage-code-3 (code-specific) | voyage-4-large (general-purpose) | Code review findings are code-adjacent; voyage-code-3 outperforms general models on code retrieval by ~14% at same dimension |

**Installation:**
```bash
bun add sqlite-vec voyageai
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── knowledge/
│   ├── store.ts              # MODIFIED: add run_state table, extend schema
│   ├── types.ts              # MODIFIED: add RunState, LearningMemory types
│   ├── db-path.ts            # UNCHANGED
│   ├── store.test.ts         # MODIFIED: test new tables and queries
│   └── confidence.ts         # UNCHANGED
├── learning/                  # NEW: embedding + memory pipeline
│   ├── embedding-provider.ts  # Voyage AI client wrapper with fail-open
│   ├── memory-store.ts        # vec0 table management, KNN retrieval
│   ├── memory-writer.ts       # Async memory write pipeline (finding -> embed -> store)
│   ├── memory-reader.ts       # Bounded retrieval with provenance logging
│   ├── isolation.ts           # Repo scope enforcement, owner-level sharing logic
│   └── types.ts               # LearningMemoryRecord, EmbeddingDocument, RetrievalResult
├── handlers/
│   ├── review.ts              # MODIFIED: check run state at ingestion, enqueue memory write
│   └── review-idempotency.ts  # MODIFIED: extend with SHA-based run identity
├── webhook/
│   └── dedup.ts               # MODIFIED or DEPRECATED: durable run state replaces in-memory map
└── execution/
    └── config.ts              # MODIFIED: add knowledge.embeddings and knowledge.sharing sections
```

### Pattern 1: Durable Run Identity with SHA-Keyed State
**What:** Replace the in-memory delivery ID deduplicator with a SQLite-backed run state table keyed by `(repo, pr_number, base_sha, head_sha)`. Each run gets a unique ID incorporating the SHA pair and delivery ID. Duplicate webhooks for the same SHA pair are skipped at ingestion before any expensive work (workspace creation, API calls).
**When to use:** At webhook receipt, before job queue enqueue.

**Recommended run identity composition:**
```
run_key = "{owner}/{repo}:pr-{number}:base-{base_sha}:head-{head_sha}"
```
This is the idempotency key. The delivery_id is stored for correlation/debugging but is NOT part of the identity key. This way, duplicate webhooks for the same SHA pair (common with GitHub retry delivery) are caught, but force-pushes (new head_sha) correctly create a new run.

**Example:**
```typescript
// Run state table schema
// CREATE TABLE IF NOT EXISTS run_state (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   run_key TEXT NOT NULL UNIQUE,
//   repo TEXT NOT NULL,
//   pr_number INTEGER NOT NULL,
//   base_sha TEXT NOT NULL,
//   head_sha TEXT NOT NULL,
//   delivery_id TEXT NOT NULL,
//   status TEXT NOT NULL DEFAULT 'pending',  -- pending|running|completed|superseded
//   created_at TEXT NOT NULL DEFAULT (datetime('now')),
//   completed_at TEXT,
//   superseded_by TEXT  -- run_key of the replacement run
// )

interface RunStateCheck {
  shouldProcess: boolean;
  runKey: string;
  reason: 'new' | 'duplicate' | 'superseded-prior';
  supersededRunKey?: string;
}

function checkAndClaimRun(params: {
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  deliveryId: string;
}): RunStateCheck {
  const runKey = `${params.repo}:pr-${params.prNumber}:base-${params.baseSha}:head-${params.headSha}`;

  // Check if this exact run already exists
  const existing = db.query("SELECT status FROM run_state WHERE run_key = $key")
    .get({ $key: runKey });

  if (existing) {
    return { shouldProcess: false, runKey, reason: 'duplicate' };
  }

  // Mark any prior runs for this PR as superseded (force-push handling)
  const priorRuns = db.query(
    "SELECT run_key FROM run_state WHERE repo = $repo AND pr_number = $pr AND status != 'superseded'"
  ).all({ $repo: params.repo, $pr: params.prNumber });

  // Insert new run and supersede old ones in a transaction
  db.transaction(() => {
    for (const prior of priorRuns) {
      db.run(
        "UPDATE run_state SET status = 'superseded', superseded_by = $newKey WHERE run_key = $oldKey",
        { $newKey: runKey, $oldKey: prior.run_key }
      );
    }
    db.run(
      "INSERT INTO run_state (run_key, repo, pr_number, base_sha, head_sha, delivery_id, status) VALUES ($key, $repo, $pr, $base, $head, $delivery, 'pending')",
      { $key: runKey, $repo: params.repo, $pr: params.prNumber, $base: params.baseSha, $head: params.headSha, $delivery: params.deliveryId }
    );
  })();

  return {
    shouldProcess: true,
    runKey,
    reason: priorRuns.length > 0 ? 'superseded-prior' : 'new',
    supersededRunKey: priorRuns.length > 0 ? priorRuns[0].run_key : undefined,
  };
}
```

### Pattern 2: sqlite-vec Memory Store with Repo Partition
**What:** Use a vec0 virtual table with `repo` as a partition key for automatic scoping of KNN queries. Metadata columns enable filtering by severity, category, and recency without post-processing.
**When to use:** For all learning memory storage and retrieval.
**Example:**
```typescript
// Source: https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html
// Schema:
// CREATE TABLE IF NOT EXISTS learning_memories (
//   id INTEGER PRIMARY KEY AUTOINCREMENT,
//   repo TEXT NOT NULL,
//   finding_id INTEGER REFERENCES findings(id),
//   review_id INTEGER REFERENCES reviews(id),
//   source_repo TEXT NOT NULL,           -- provenance: which repo created this memory
//   finding_text TEXT NOT NULL,
//   severity TEXT NOT NULL,
//   category TEXT NOT NULL,
//   file_path TEXT NOT NULL,
//   outcome TEXT NOT NULL,               -- 'accepted' | 'suppressed' | 'thumbs_up' | 'thumbs_down'
//   embedding_model TEXT NOT NULL,
//   embedding_dim INTEGER NOT NULL,
//   created_at TEXT NOT NULL DEFAULT (datetime('now')),
//   UNIQUE(repo, finding_id, outcome)
// );
//
// CREATE VIRTUAL TABLE IF NOT EXISTS learning_memory_vec USING vec0(
//   memory_id INTEGER PRIMARY KEY,
//   embedding float[1024],
//   repo TEXT partition key,
//   severity TEXT,
//   category TEXT
// );

import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

// Load extension
sqliteVec.load(db);

// Insert memory with embedding
function writeMemory(params: {
  memoryId: number;
  embedding: Float32Array;
  repo: string;
  severity: string;
  category: string;
}) {
  db.prepare(`
    INSERT INTO learning_memory_vec(memory_id, embedding, repo, severity, category)
    VALUES (?, vec_f32(?), ?, ?, ?)
  `).run(params.memoryId, params.embedding, params.repo, params.severity, params.category);
}

// KNN retrieval scoped to repo
function retrieveMemories(params: {
  queryEmbedding: Float32Array;
  repo: string;
  topK: number;
  minSeverity?: string;
}): { memoryId: number; distance: number }[] {
  return db.prepare(`
    SELECT memory_id, distance
    FROM learning_memory_vec
    WHERE embedding MATCH ?
      AND k = ?
      AND repo = ?
    ORDER BY distance
  `).all(params.queryEmbedding, params.topK, params.repo);
}
```

### Pattern 3: Fail-Open Embedding Generation
**What:** Wrap all Voyage AI calls in try/catch with graceful degradation. If embedding generation fails, the review publishes without memory. Memory writes happen asynchronously after review completion.
**When to use:** Every embedding API call and memory write operation.
**Example:**
```typescript
import { VoyageAIClient, VoyageAIError } from "voyageai";

const client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

async function generateEmbedding(params: {
  text: string;
  model: string;
  logger: Logger;
}): Promise<Float32Array | null> {
  try {
    const response = await client.embed({
      input: params.text,
      model: params.model,
      inputType: "document",
    }, {
      timeoutInSeconds: 10,
      maxRetries: 2,
    });

    if (!response.data?.[0]?.embedding) {
      params.logger.warn({ model: params.model }, "Embedding response missing data");
      return null;
    }

    return new Float32Array(response.data[0].embedding);
  } catch (err) {
    if (err instanceof VoyageAIError) {
      params.logger.warn({
        statusCode: err.statusCode,
        message: err.message,
      }, "Voyage AI embedding generation failed (fail-open)");
    } else {
      params.logger.warn({ err }, "Embedding generation failed (fail-open)");
    }
    return null;
  }
}
```

### Pattern 4: Owner-Level Sharing with Config Flag
**What:** Extend the existing `knowledge` config section with `sharing.enabled` (boolean, default false) and `sharing.scope` (always "owner" for now). When enabled, retrieval queries the shared pool filtered by `owner = ?` in addition to the repo's own memories. Full provenance is logged.
**When to use:** For repos that opt in to cross-repo learning within the same GitHub owner/org.

**Recommended config extension:**
```yaml
# .kodiai.yml
knowledge:
  shareGlobal: false         # existing - deprecated, replaced by sharing section
  sharing:
    enabled: false            # opt-in to owner-scoped shared learning pool
    # scope: "owner"          # always owner for now; future: "org", "explicit-allowlist"
  embeddings:
    enabled: true             # master switch for embedding generation
    model: "voyage-code-3"    # embedding model name
    dimensions: 1024          # output dimensions (256, 512, 1024, 2048)
```

### Anti-Patterns to Avoid
- **Inline embedding calls in the review critical path:** Never call Voyage AI during review prompt construction. Retrieve existing embeddings synchronously; generate new ones asynchronously after review completes.
- **Mixing embedding model versions in same vec0 table without tracking:** Always store `embedding_model` on the metadata record. Vectors from different models are incomparable.
- **Using delivery_id as the sole run identity key:** Delivery IDs are unique per webhook delivery but do NOT represent logical run identity. The same PR at the same SHAs can receive multiple deliveries (retries). Use SHA pair as the identity.
- **Hard-failing on sqlite-vec load failure:** If the extension cannot load (e.g., platform issue), degrade to a no-op memory store. Log the failure and continue with review-only mode.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom cosine distance loops over blob arrays | `sqlite-vec` vec0 virtual table with `MATCH` + `ORDER BY distance` | Handles chunked storage, platform-optimized distance computation, metadata filtering in single SQL query |
| Embedding generation with retry/timeout | Raw `fetch()` with manual retry logic | `voyageai` SDK with `maxRetries`, `timeoutInSeconds`, `abortSignal` | Handles 429/5xx retries with exponential backoff, typed errors, abort propagation |
| Run state deduplication | In-memory Map with periodic cleanup | SQLite `run_state` table with UNIQUE constraint on `run_key` | Survives process restarts, handles concurrent webhooks via SQLite serialization, enables audit queries |
| Repo isolation in vector queries | Application-level filtering after full KNN scan | vec0 `partition key` on `repo` column | Pre-filters at storage level; only scans vectors for the target repo, significant performance improvement |
| Float array serialization | JSON.stringify/parse for embedding vectors | `Float32Array` + `vec_f32()` SQL function | 4x more compact than JSON, native binary format for sqlite-vec |

**Key insight:** The combination of sqlite-vec partition keys and metadata columns handles the entire isolation + filtering problem in SQL, eliminating the need for application-level post-processing of vector results.

## Common Pitfalls

### Pitfall 1: macOS Extension Loading Failure
**What goes wrong:** `sqliteVec.load(db)` or `db.loadExtension()` fails silently or crashes on macOS because Apple ships a proprietary SQLite build that doesn't support extensions.
**Why it happens:** macOS system SQLite disables `sqlite3_load_extension`.
**How to avoid:** On macOS development, use `Database.setCustomSQLite("/usr/local/opt/sqlite3/lib/libsqlite3.dylib")` before creating the Database. In production (Linux container), this is not needed. Gate with platform detection and log clearly on failure.
**Warning signs:** Segfault on extension load, `vec0` module not found errors.

### Pitfall 2: Mixing Embedding Model Versions
**What goes wrong:** KNN results return nonsensical distances because vectors from voyage-code-2 (or a different dimension) are compared against voyage-code-3 query vectors.
**Why it happens:** Model upgrade without re-embedding existing vectors; or dimension mismatch (512 vs 1024).
**How to avoid:** Store `embedding_model` and `embedding_dim` on every memory record. On model upgrade, mark old vectors as `stale` and re-embed in background. Only compare vectors from the same model+dimension.
**Warning signs:** Retrieval quality suddenly drops; distance values are abnormally high or uniform.

### Pitfall 3: Delivery ID vs SHA Pair Confusion in Run Identity
**What goes wrong:** Same review runs twice for the same SHA pair because delivery IDs differ (GitHub retry), or force-push review is blocked because old SHA pair is still "in progress."
**Why it happens:** Using delivery_id as the primary identity key instead of the (base_sha, head_sha) pair.
**How to avoid:** Use `repo:pr:base_sha:head_sha` as the run identity key. Store delivery_id for correlation but not for uniqueness. On force-push (new head_sha), supersede old runs.
**Warning signs:** Duplicate review comments on the same PR, or missing reviews after force-push.

### Pitfall 4: Unbounded Memory Retrieval in Review Path
**What goes wrong:** Retrieval queries return hundreds of results, bloating the prompt and increasing latency/cost.
**Why it happens:** No `k` limit or score threshold on KNN query.
**How to avoid:** Hard-cap `k` (e.g., 10-20), apply distance threshold, and enforce total character budget for retrieved context.
**Warning signs:** Review prompt grows unpredictably; token costs spike; review quality degrades from context pollution.

### Pitfall 5: Blocking Review on Embedding API Failure
**What goes wrong:** Review publication is delayed or fails because Voyage AI is down or rate-limited.
**Why it happens:** Embedding generation called synchronously in the review path.
**How to avoid:** Generate embeddings asynchronously AFTER review completion. Retrieval uses only pre-existing embeddings. If no embeddings exist yet (first review), review proceeds without memory context.
**Warning signs:** Review latency correlates with Voyage API latency; 429 errors cascade to review failures.

### Pitfall 6: Shared Pool Data Leaks Across Owners
**What goes wrong:** A repo in org-A retrieves memories from org-B because the sharing query doesn't filter by owner.
**Why it happens:** Shared pool query uses `repo != current_repo` instead of `owner = current_owner`.
**How to avoid:** Always filter shared pool queries by owner. Use SQLite CHECK constraints or application-level assertions. Test with multi-owner fixtures.
**Warning signs:** Provenance logs show foreign-owner repos contributing to suggestions.

### Pitfall 7: run_state Table Growing Unbounded
**What goes wrong:** Run state table accumulates millions of rows over time, slowing idempotency lookups.
**Why it happens:** No retention/cleanup policy for completed/superseded runs.
**How to avoid:** Add a retention policy: purge `completed` and `superseded` runs older than 30 days (configurable). Keep the UNIQUE index on `run_key` for fast lookups.
**Warning signs:** Slow startup, increasing idempotency check latency over time.

## Code Examples

Verified patterns from official sources:

### sqlite-vec Loading and Basic Usage (Bun)
```typescript
// Source: https://alexgarcia.xyz/sqlite-vec/js.html
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const db = new Database("./data/kodiai-knowledge.db", { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");

// Load sqlite-vec extension
sqliteVec.load(db);

// Verify loaded
const { vec_version } = db.prepare("SELECT vec_version() AS vec_version").get() as { vec_version: string };
console.log(`sqlite-vec version: ${vec_version}`);

// Create vec0 table with metadata columns and partition key
db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS learning_memory_vec USING vec0(
    memory_id INTEGER PRIMARY KEY,
    embedding float[1024],
    repo TEXT partition key,
    severity TEXT,
    category TEXT
  )
`);
```

### Voyage AI Embedding Generation
```typescript
// Source: https://github.com/voyage-ai/typescript-sdk
import { VoyageAIClient } from "voyageai";

const client = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! });

// Single embedding
const result = await client.embed({
  input: "SQL injection vulnerability in user input handling",
  model: "voyage-code-3",
  inputType: "document",
});

// Batch embeddings (up to 1000 items, 120K token limit for voyage-code-3)
const batchResult = await client.embed({
  input: [
    "Finding: unused variable in production code",
    "Finding: missing null check before property access",
    "Finding: hardcoded credential in config file",
  ],
  model: "voyage-code-3",
  inputType: "document",
});
```

### KNN Query with Metadata Filtering
```typescript
// Source: https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html
const results = db.prepare(`
  SELECT
    memory_id,
    distance
  FROM learning_memory_vec
  WHERE embedding MATCH ?
    AND k = ?
    AND repo = ?
    AND severity IN ('critical', 'major')
  ORDER BY distance
`).all(
  new Float32Array(queryEmbedding),  // 1024-dim query vector
  10,                                  // top-K
  "owner/repo"                         // partition key filter
) as { memory_id: number; distance: number }[];
```

### Run State Schema
```sql
-- Durable run identity table
CREATE TABLE IF NOT EXISTS run_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_key TEXT NOT NULL UNIQUE,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  superseded_by TEXT,
  UNIQUE(repo, pr_number, base_sha, head_sha)
);

CREATE INDEX IF NOT EXISTS idx_run_state_repo_pr ON run_state(repo, pr_number);
CREATE INDEX IF NOT EXISTS idx_run_state_status ON run_state(status);
```

### Learning Memory Metadata Schema
```sql
-- Memory records with full provenance
CREATE TABLE IF NOT EXISTS learning_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  owner TEXT NOT NULL,
  finding_id INTEGER REFERENCES findings(id),
  review_id INTEGER REFERENCES reviews(id),
  source_repo TEXT NOT NULL,
  finding_text TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  file_path TEXT NOT NULL,
  outcome TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo, finding_id, outcome)
);

CREATE INDEX IF NOT EXISTS idx_memories_repo ON learning_memories(repo);
CREATE INDEX IF NOT EXISTS idx_memories_owner ON learning_memories(owner);
CREATE INDEX IF NOT EXISTS idx_memories_stale ON learning_memories(stale);
CREATE INDEX IF NOT EXISTS idx_memories_model ON learning_memories(embedding_model);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| sqlite-vss (Faiss-based) | sqlite-vec (pure C, metadata columns, partition keys) | Aug 2024 (v0.1.0), Nov 2024 (v0.1.6 metadata) | No Faiss dependency, better insert/update/delete performance, built-in filtering |
| In-memory Map for webhook dedup | SQLite-backed run state with SHA-keyed identity | Phase 30 (new) | Survives restarts, enables audit trail, handles force-push supersession |
| GitHub comment marker scan for idempotency | Database run state check at ingestion | Phase 30 (new) | Eliminates expensive GitHub API calls for duplicate detection |
| Application-level vector post-filtering | sqlite-vec partition keys + metadata columns | sqlite-vec v0.1.6 (Nov 2024) | Repo isolation enforced at storage layer, not application layer |

**Deprecated/outdated:**
- **sqlite-vss:** Superseded by sqlite-vec. sqlite-vss is based on Faiss and has heavier dependencies. The same author created both; sqlite-vec is the recommended replacement.
- **Raw Voyage API calls via `fetch`:** The official `voyageai` TypeScript SDK (v0.1.0) now handles retries, error typing, and abort signals natively.

## Open Questions

1. **sqlite-vec Stability on Linux in Production**
   - What we know: v0.1.6 is stable release; v0.1.7-alpha.2 exists with Linux ARM fixes. The npm `load()` function handles platform binary selection. Extension loading works on Linux with Bun.
   - What's unclear: No production deployment reports found for sqlite-vec + Bun specifically. The library is relatively new.
   - Recommendation: Write a startup health check that verifies `vec_version()` returns successfully. If extension loading fails, degrade to no-memory mode with clear logging. This aligns with the fail-open philosophy.

2. **Optimal Embedding Dimension for Cost/Quality Tradeoff**
   - What we know: voyage-code-3 supports 256, 512, 1024, 2048 dimensions. At 1024 dims it outperforms OpenAI-v3-large by 14.64%. Lower dimensions reduce storage and improve search speed.
   - What's unclear: Whether 512 dims is "good enough" for code review finding similarity, or whether 1024 is worth the storage cost.
   - Recommendation: Default to 1024 dimensions. Make it configurable via `knowledge.embeddings.dimensions`. The storage difference at expected corpus sizes (<100K vectors) is negligible (400KB vs 200KB per 1000 vectors).

3. **Re-embedding Migration Concurrency**
   - What we know: Model upgrades require re-embedding old memories. Background re-embedding must not interfere with active review processing.
   - What's unclear: Optimal batch size and concurrency for re-embedding without hitting Voyage API rate limits.
   - Recommendation: Use a simple migration table tracking `(model_version, memory_id, status)`. Process in batches of 50-100 items with p-queue concurrency of 1. Mark old vectors as `stale` during migration; only use same-model vectors in retrieval.

4. **Retention Policy for Superseded Runs**
   - What we know: Force-pushed runs are marked superseded. Completed runs are kept for audit.
   - What's unclear: How long to retain old run state before purging.
   - Recommendation: 30-day retention for completed runs, 7-day for superseded. Add a startup purge similar to existing telemetry retention (`telemetryStore.purgeOlderThan(90)`).

## Sources

### Primary (HIGH confidence)
- Codebase: `src/knowledge/store.ts` - existing SQLite knowledge store patterns (WAL, prepared statements, transactions)
- Codebase: `src/webhook/dedup.ts` - current in-memory deduplication (to be replaced)
- Codebase: `src/handlers/review-idempotency.ts` - current GitHub marker-based idempotency
- Codebase: `src/handlers/review.ts` - review handler flow, knowledge store integration points
- Codebase: `src/execution/config.ts` - existing config schema with `knowledge.shareGlobal`
- Codebase: `src/index.ts` - application wiring, store initialization patterns
- [sqlite-vec JS documentation](https://alexgarcia.xyz/sqlite-vec/js.html) - Bun integration, `load()` function, Float32Array usage
- [sqlite-vec metadata release blog](https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html) - metadata columns, partition keys, WHERE clause filtering in KNN queries (v0.1.6)
- [Voyage AI embedding docs](https://docs.voyageai.com/docs/embeddings) - model specs, dimensions, batch limits, input types
- [Voyage AI pricing](https://docs.voyageai.com/docs/pricing) - voyage-code-3 at $0.18/1M tokens, 200M free tokens
- [Voyage AI TypeScript SDK](https://github.com/voyage-ai/typescript-sdk) - client initialization, embed method, error handling, retry config

### Secondary (MEDIUM confidence)
- [sqlite-vec v0.1.0 release blog](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html) - vec0 features, brute-force performance benchmarks, limitations
- [sqlite-vec GitHub releases](https://github.com/asg017/sqlite-vec/releases) - version history, v0.1.7-alpha.2 latest
- [voyage-code-3 announcement](https://blog.voyageai.com/2024/12/04/voyage-code-3/) - code retrieval benchmarks, dimension/quantization options
- [Bun SQLite docs](https://bun.com/docs/runtime/sqlite) - extension loading, macOS caveat, WAL support
- Project research: `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md` - v0.5 stack and architecture decisions

### Tertiary (LOW confidence)
- [Milvus best practices for embedding updates](https://milvus.io/ai-quick-reference/what-are-the-best-practices-for-managing-embedding-updates) - general patterns for model migration, hybrid search during transition (not sqlite-vec specific)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - sqlite-vec, voyageai SDK, and bun:sqlite are verified via official docs and existing codebase patterns
- Architecture: MEDIUM-HIGH - run identity and memory store patterns are well-understood; sqlite-vec metadata/partition key features verified; Bun production deployment of sqlite-vec is the main uncertainty
- Pitfalls: HIGH - drawn from verified platform constraints (macOS), API behavior (Voyage rate limits), and existing codebase patterns (fail-open, non-fatal writes)
- Isolation: MEDIUM-HIGH - partition key approach verified in sqlite-vec docs; owner-level sharing logic is application code without novel technical risk

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (sqlite-vec is still maturing; check for v0.1.7 stable release)
