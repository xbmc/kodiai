# Resource and Throughput Hardening Design

**Date:** 2026-07-30

**Status:** Draft for user review

## Purpose

This is the first of three remediation phases derived from the repository-wide thermo-nuclear maintainability review and code-optimizer audit. It removes bounded-resource, avoidable-I/O, cache, build, and deployment bottlenecks while preserving current GitHub, Slack, review, and write-mode behavior.

The later phases own review-graph redesign and review/prompt architecture cleanup. This phase may add narrow shared utilities needed by those phases, but it must not partially rewrite either subsystem.

## Goals

- Bound every repository-controlled or agent-controlled whole-file read on a production path.
- Replace serial independent I/O with batching or explicitly bounded concurrency.
- Eliminate repeated external requests and cache stampedes.
- Remove misleading eager-loader and duplicate/dead implementation paths.
- Improve container build, startup, deployment, and logging efficiency.
- Replace the process-local MCP callback grant registry so horizontal scaling can be enabled safely.
- Preserve fail-open behavior where the existing feature is advisory and fail closed where incomplete evidence would weaken a security control.

## Non-goals

- Redesigning review-graph storage, indexing, or blast-radius traversal. Phase 2 owns that work.
- Replacing the central review orchestration function or prompt-builder architecture. Phase 3 owns that work.
- Changing review conclusions, publication policy, contributor scoring formulas, or user-visible wording except for explicit bounded-resource errors and degraded-state diagnostics.
- Adding Redis. PostgreSQL remains the shared durable coordination layer.
- Adding speculative caches without a bounded size, TTL, versioned key, and explicit invalidation rule.

## Architecture

The phase is divided into six independently testable slices. Each slice must be deployable on its own.

The implementation will use separate task plans for bounded resources, I/O and caching, local algorithms, runtime/build cleanup, and durable MCP grants. This keeps reviews and rollbacks scoped even though the slices share this design contract.

### 1. Bounded input and output consumption

Add a small canonical bounded-file reader that checks `BunFile.size` before materializing text and returns a typed over-limit error containing the path, actual bytes, and configured limit.

Use these limits:

- `.kodiai.yml`: 256 KiB.
- ACA `result.json`: 16 MiB.
- Fabricated-content commit diff: 2 MiB, matching the existing review-diff command ceiling.
- Staged write-policy diff: 8 MiB.

Configuration and result reads reject over-limit input before parsing. Fabricated-content scanning returns a typed incomplete-scan result instead of silently treating a truncated scan as clean. Write-mode secret scanning fails closed when the staged diff exceeds its budget because publishing after an incomplete security scan would weaken the current contract.

Diff consumers use the existing capped-process infrastructure. They retain only added-line scanner state and bounded match context, not the complete diff plus derivative maps and joined copies.

### 2. External I/O batching and bounded concurrency

Use the existing `mapWithConcurrency` helper where available. New concurrency limits must be constants and injectable in tests:

- GitHub PR-file requests: 4.
- Cluster label generation: 3.
- Repository file reads/config probes: 16.
- Multi-PR CI processing: 4.
- Azure Files cleanup: 4.

Contributor expertise recomputation collects all expertise rows and calls `upsertExpertiseMany` once. Authored PR discovery requests only merged PRs for the target author, fetches file lists with bounded concurrency, and caches immutable results by repository, PR number, and head or merge SHA. Cache entries use a bounded LRU and TTL; a later durable cache is permitted only if measured recomputation frequency justifies a migration.

Independent git or database operations start together with `Promise.all` while retaining separate timeout and error classification. Ordered pagination, retry/backoff loops, and stateful webhook replay remain sequential.

### 3. Cache ownership and request coalescing

Mention-context fingerprinting returns both the fingerprint and the normalized fetched source material. A cache miss builds rendered context from that exact snapshot instead of fetching comments and PR metadata again. Cache hits may continue to refresh fingerprint material when freshness requires it.

`StructuralImpactCache` gains `getOrLoad` with in-flight promise coalescing. It removes the in-flight entry on either resolution or rejection and caches only statuses currently eligible for caching.

Embedding reuse gains a process-wide bounded LRU layered underneath the existing request-scoped cache. Its key contains a SHA-256 digest of normalized text plus provider identity, model, dimensions, input type, and cache schema version. Raw query text is never used as a cache key. Invalid vectors and rejected requests are never cached. Concurrent identical requests share one in-flight promise.

Review-graph snapshot/index caching is explicitly deferred to Phase 2 because caching the current whole-workspace design would mask rather than remove its scaling problem.

### 4. Local algorithmic and data-structure fixes

- Pre-index validation evidence by the accepted correlation identifiers while preserving current first-match semantics.
- Cache normalized file lines and group retrieval findings by file before snippet resolution.
- Normalize PR description, diff, and commit-message overlap inputs once and use token sets for repeated claim checks.
- Replace the bounded sorted-array top-k implementation with a min-heap while preserving deterministic tie ordering.
- Precompute addon path projections once per addon.
- Parse review-comment timestamps once before sorting.
- Bound wiki evidence and publisher queue reads in SQL and process them through keyset/bounded batches.
- Batch telemetry retention deletes outside the readiness-critical startup path.

Every change must include equivalence tests for output ordering and edge cases, not only performance-shape assertions.

### 5. Runtime loading, resilience, logging, and build pipeline

MCP server module loaders become actual async dynamic imports. Retry-safe constants and other entrypoint-only values move to dependency-light modules so importing one constant does not evaluate every MCP server.

Workspace cleanup and agent diagnostic-sink failures remain secondary to the primary job error but are never silent. They emit one bounded structured diagnostic and stop retrying a known-bad diagnostic sink.

Finding-level and chunk-level logs use counts plus bounded samples. Provider-wide failures are aggregated per file or batch and rate-limited.

Production Bun bundles use minification with source-map support suitable for stack-trace symbolication. TypeScript moves from peer dependencies to development dependencies. App and agent images derive from one immutable, versioned runtime base containing their shared OS and Python tooling. The two application builds run concurrently with explicit status collection.

### 6. Durable MCP callback grants and horizontal scaling

Replace the registry of process-local server-factory closures with a serializable `McpCallbackGrant` contract persisted in PostgreSQL. A grant contains:

- SHA-256 token digest; plaintext bearer tokens are never stored.
- Expiry and revocation timestamps.
- Installation, repository, PR/issue, delivery, review-output, and correlation identifiers required by the enabled tools.
- The exact enabled MCP server names and publication mode.
- A schema version for safe rolling deployment.

Each replica validates the bearer-token digest, loads the grant, and constructs the requested server from canonical application dependencies and the grant context. One-time or publication deduplication semantics remain backed by existing durable stores and correlation keys; no correctness decision may depend on replica memory.

Grant creation and agent launch form one failure-safe sequence: a failed launch revokes the grant; expiry provides cleanup for abandoned launches. Grant lookup is indexed by token digest and expiry. Cleanup deletes expired/revoked grants in bounded batches.

`ACA_MAX_REPLICAS > 1` remains rejected until integration tests prove that a grant created through one application instance can be served by another and that revocation/expiry are honored. Once proven, the deploy guard is replaced with validation that the durable grant migration is present and configured.

## Error handling

- Oversized configuration fails before YAML parsing with a bounded actionable error.
- Oversized or malformed agent results produce the existing executor failure shape plus a bounded diagnostic tail.
- Incomplete fabricated-content scans return degraded evidence and block any code path that currently requires a clean scan.
- Incomplete secret scans fail closed with `write-policy-secret-scan-incomplete` and include the byte limit, not repository content.
- Bounded-concurrency workers isolate advisory item failures where existing code is fail-open and abort where existing behavior is atomic.
- Cache-loader failures are never cached and never leave a rejected promise in the in-flight map.
- Durable MCP grants default deny on missing, expired, revoked, version-incompatible, or context-mismatched rows.

## Data changes

Add an `mcp_callback_grants` migration with:

- `token_digest text primary key`
- `schema_version integer not null`
- `expires_at timestamptz not null`
- `revoked_at timestamptz null`
- bounded scalar context columns for routing and correlation
- `enabled_servers jsonb not null`
- `grant_context jsonb not null` containing only the reviewed serializable contract
- `created_at` and `updated_at`

Add an expiry/active lookup index and a complete down migration. No raw bearer token, GitHub token, private key, prompt, diff, finding body, or arbitrary webhook payload may be stored.

## Testing strategy

All production changes follow red-green-refactor.

- Unit tests prove each byte boundary at limit, limit plus one, missing file, malformed content, and normal content.
- Streaming scanner tests prove cross-chunk matching behavior, added-line selection, truncation classification, and fail-closed write policy.
- Concurrency tests use controlled deferred promises to prove the maximum in-flight count and deterministic result order.
- Cache tests cover hits, misses, in-flight coalescing, rejection cleanup, TTL, LRU eviction, versioned keys, and tenant/provider separation.
- Algorithm tests compare optimized output with representative legacy fixtures and cover stable tie ordering.
- Logging tests assert bounded samples and aggregated counts without raw oversized content.
- MCP grant unit tests cover hashing, expiry, revocation, schema mismatch, server allowlists, and context reconstruction.
- Cross-instance integration tests create a grant with store/service instance A and serve it through instance B.
- Deployment tests retain the single-replica refusal until cross-instance tests pass, then prove multi-replica configuration is accepted only with the durable grant store.
- Each slice runs targeted tests before the repository-wide unit, DB, lint, and TypeScript verification gates.

## Rollout

1. Ship bounded reads/scans, local algorithms, batching, cache coalescing, and dynamic imports with no deployment topology change.
2. Ship the durable MCP grant table and dual-read compatibility for in-flight jobs created by the previous revision.
3. Switch new launches to durable grants while keeping `ACA_MAX_REPLICAS=1`.
4. Run cross-instance production-like smoke tests and observe unauthorized, expired-grant, callback-latency, and duplicate-publication metrics.
5. Remove the process-local registry compatibility path and enable controlled horizontal scaling.

Rollback before step 5 restores the prior application revision while retaining the inert grant table. Rollback after step 5 first restores one replica, then rolls back application code. The migration remains backward-compatible until a later release removes it.

## Acceptance criteria

- All audited Phase 1 findings are either fixed or explicitly demonstrated inapplicable with tests/evidence.
- No production path materializes repository-controlled configuration, agent result JSON, fabricated-content diff, or staged security-scan diff without an enforced byte ceiling.
- Contributor expertise uses one batch UPSERT and no unbounded or serial per-PR file-request loop.
- Identical concurrent structural-impact loads and embedding requests coalesce.
- Mention-context cache fills do not refetch fingerprint inputs.
- MCP server modules load only when enabled.
- The deployment can safely use more than one replica only after durable cross-instance MCP callback authorization passes.
- Targeted tests, full unit tests, DB tests, lint, and TypeScript checks pass with fresh evidence.
