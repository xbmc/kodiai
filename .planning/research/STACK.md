# Stack Research

**Domain:** AI GitHub App enhancements (embeddings, incremental re-review, multi-language analysis)
**Researched:** 2026-02-12
**Confidence:** MEDIUM

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Voyage Embeddings API | v1 (HTTP) | Generate embeddings for feedback clustering and retrieval | Best fit for the new learning loop; Anthropic explicitly points to Voyage for embeddings, and Voyage now exposes code + multilingual-capable models. |
| `sqlite-vec` | `0.1.7-alpha.2` | Vector similarity search directly in existing SQLite DB | Preserves Bun + SQLite architecture and avoids adding external vector infrastructure for v0.5. |
| `bun:sqlite` extension loading | Bun `1.3.8` (installed) | Host scalar tables + vector tables in same file | Keeps operational model unchanged (single DB, WAL, local transactions). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `linguist-languages` | `9.3.1` | Extension/shebang-based language detection aligned with GitHub Linguist data | Use for per-file language tagging in diff analysis and language-aware prompt shaping. |
| `@anthropic-ai/claude-agent-sdk` | upgrade `0.2.37 -> 0.2.39` | Keep executor layer current while adding more MCP tools for re-review/learning | Upgrade alongside v0.5 rollout to reduce SDK drift risk. |
| `@octokit/webhooks-types` | keep `7.6.1` | Existing typed webhook surface for feedback/reactions | No new package needed; reuse current event ingestion path. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `git patch-id --stable` | Fingerprint semantically equivalent diffs for incremental re-review | Use in Bun `Bash(...)` calls; avoids new hashing libs and is robust to line-number churn. |
| Bun native `fetch` | Voyage API calls without extra HTTP client | Prefer over adding transport libs in Bun runtime. |

## Why These Additions Are Needed (vs current stack)

- Current knowledge store in `src/knowledge/store.ts` tracks structured findings/reactions but has no semantic retrieval, so embeddings + vector search are required for clustering similar feedback across PRs.
- Current re-review flow in `src/handlers/review.ts` re-analyzes full PR context; adding patch fingerprints + prior finding retrieval enables incremental re-review instead of full replay.
- Current diff categorization in `src/execution/diff-analysis.ts` is category-based (source/test/config/docs/infra), not language-aware; multi-language support needs explicit language tagging.
- Current prompt builder in `src/execution/review-prompt.ts` is language-agnostic; adding language-conditioned guardrails improves coverage for non-TS repos.

## Integration Points in Current Codebase

| Area | File(s) | Change |
|------|---------|--------|
| Embedding generation | `src/handlers/feedback-sync.ts`, `src/handlers/review.ts` | On new findings/reactions, enqueue embedding jobs and store vectors + metadata. |
| Vector storage/query | `src/knowledge/store.ts` | Add `embedding_items` metadata table + `vec0` virtual table; add nearest-neighbor lookup methods. |
| Incremental re-review cache keys | `src/handlers/review.ts` | Compute `patch_id` and lookup prior findings by `repo + file_path + patch_id` before publishing comments. |
| Language detection | `src/execution/diff-analysis.ts` | Map changed files to languages (via `linguist-languages`) and expose histogram/signals in `DiffAnalysis`. |
| Prompt adaptation | `src/execution/review-prompt.ts` | Inject language-specific review directives and suppress unsupported-language heuristics. |
| Config surface | `src/execution/config.ts` | Add `review.embeddings`, `review.incremental`, `review.languages` sections with safe defaults and kill-switches. |

## Data Model Additions (SQLite)

Use existing DB initialization pattern in `src/knowledge/store.ts`.

```sql
CREATE TABLE IF NOT EXISTS embedding_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,
  source_type TEXT NOT NULL,            -- finding|reaction|summary
  source_id TEXT NOT NULL,              -- stable app identifier
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  language TEXT,
  payload_json TEXT,
  UNIQUE(repo, source_type, source_id, model)
);

-- sqlite-vec virtual table (1024-d example)
CREATE VIRTUAL TABLE IF NOT EXISTS embedding_vec
USING vec0(embedding float[1024], item_id integer primary key);

CREATE INDEX IF NOT EXISTS idx_embedding_items_repo_source
ON embedding_items(repo, source_type, created_at);
```

## Installation

```bash
# Core additions
bun add sqlite-vec linguist-languages

# Keep executor SDK current
bun add @anthropic-ai/claude-agent-sdk@^0.2.39
```

No additional DB service is required.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `sqlite-vec` in-process | Hosted vector DB (Pinecone/Qdrant/Weaviate) | Use only if dataset growth or latency SLOs outgrow single-node SQLite. |
| Voyage API via Bun `fetch` | `voyageai` SDK (`0.1.0`) | Use SDK if typed client ergonomics outweigh dependency footprint. |
| `linguist-languages` | Hand-maintained extension map | Only for ultra-minimal deployments; higher long-term drift risk. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `github-linguist` gem / Ruby runtime in app path | Adds Ruby/native dependency chain and complicates Bun deployment | `linguist-languages` JS package using Linguist data |
| External message bus (Kafka/NATS) for embedding jobs | Operational overhead is disproportionate to v0.5 workload | Existing in-process queue (`p-queue`) + SQLite job bookkeeping |
| New ORM migration for vector work | Adds migration + runtime complexity during feature milestone | Continue raw SQL in `src/knowledge/store.ts` with explicit migrations |
| Immediate cross-provider embedding stack | More keys, more retry logic, harder eval baselines | Single provider (Voyage) for v0.5, revisit after offline evals |

## Stack Patterns by Variant

**If deployment can load SQLite extensions reliably (Linux container baseline):**
- Use `sqlite-vec` for ANN/KNN lookup in-process.
- Because it gives the simplest architecture and best fit with existing SQLite persistence.

**If extension loading is blocked (notably some macOS setups):**
- Keep `embedding_items` table, store vectors as blobs/JSON, and do brute-force cosine in application code as temporary fallback.
- Because it preserves functionality without blocking rollout; switch to `sqlite-vec` where extension support is guaranteed.

## Migration and Compatibility Notes

- **Native dependency risk:** `sqlite-vec` is alpha and uses platform-specific binaries; validate container image and startup health checks before enabling by default.
- **macOS caveat:** Bun docs note extension loading may require `Database.setCustomSQLite(...)` with a non-system SQLite dylib.
- **Runtime compatibility:** `linguist-languages` is pure ESM data and Bun-compatible; low deployment risk.
- **Schema migration:** introduce additive tables only; keep existing `reviews/findings/feedback_reactions` untouched for backward compatibility.
- **Rollout safety:** gate v0.5 logic behind config flags (`review.embeddings.enabled`, `review.incremental.enabled`, `review.languages.enabled`).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `sqlite-vec@0.1.7-alpha.2` | `bun:sqlite` in Bun `1.3.8` | Works with extension loading; confirm platform binary availability in CI image. |
| `linguist-languages@9.3.1` | Bun ESM runtime | Data-only package; no native bindings. |
| `@anthropic-ai/claude-agent-sdk@0.2.39` | `zod@4.3.6` | SDK declares peer compatibility with Zod v4. |

## Sources

- https://registry.npmjs.org/sqlite-vec/latest - version and package status (`0.1.7-alpha.2`) (HIGH)
- https://alexgarcia.xyz/sqlite-vec/js.html - Bun usage and extension-loading details (MEDIUM)
- https://bun.com/docs/runtime/sqlite - `bun:sqlite` and `.loadExtension()` behavior, macOS caveat (HIGH)
- https://docs.anthropic.com/en/docs/build-with-claude/embeddings - Anthropic guidance to use Voyage for embeddings (HIGH)
- https://docs.voyageai.com/docs/embeddings - current model lineup (including multilingual and code-focused options) (HIGH)
- https://registry.npmjs.org/voyageai/latest - TypeScript SDK current npm version (`0.1.0`) (HIGH)
- https://registry.npmjs.org/linguist-languages/latest - package/version (`9.3.1`) (HIGH)
- https://raw.githubusercontent.com/ikatyang-collab/linguist-languages/main/README.md - package maps GitHub Linguist language data (MEDIUM)
- https://raw.githubusercontent.com/github-linguist/linguist/main/README.md - Linguist scope and Ruby dependency burden (HIGH)
- https://git-scm.com/docs/git-patch-id - stable patch fingerprinting for duplicate/incremental detection (HIGH)

---
*Stack research for: Kodiai v0.5 Advanced Learning & Language Support*
*Researched: 2026-02-12*
