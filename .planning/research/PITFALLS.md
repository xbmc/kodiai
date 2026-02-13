# Pitfalls Research

**Domain:** v0.5 advanced learning and language support for an existing deterministic + LLM PR review app
**Researched:** 2026-02-12
**Confidence:** MEDIUM-HIGH (integration risks are high confidence; model-behavior risks are medium)

## Critical Pitfalls

### Pitfall 1: Embedding Index Drift Creates Silent Wrong Context (P0)

**What goes wrong:**
Embeddings are generated with model/version A, then retrieval queries use model/version B (or different normalization/chunking). Similarity search returns plausible but wrong context, so reviews cite irrelevant files and miss real regressions.

**Why it happens:**
Teams ship embedding upgrades incrementally without strict compatibility contracts, and existing records are not backfilled atomically.

**How to avoid:**
- Version every vector with `embedding_model`, `dimensions`, `distance_metric`, `chunk_schema_version`, `content_hash`.
- Reject mixed-model retrieval by default (hard fail, not warn).
- Add dual-index migration path: build new index in shadow, run recall comparison, then cut over.
- Gate release on retrieval regression tests (golden PR corpus; recall@k floor by language).

**Warning signs:**
- Sudden drop in retrieval overlap between consecutive runs for same commit.
- Review comments citing files not touched or semantically related.
- Recall@k drift after deploy without code changes in ranking logic.

**Phase to address:**
Phase 1 - Data contracts and migration safety rails.

---

### Pitfall 2: Incremental Re-Review Uses Wrong Baseline SHA (P0)

**What goes wrong:**
Incremental re-review computes delta against stale baseline (old head, wrong merge-base, or duplicated webhook delivery). System re-evaluates already-reviewed code or skips new changes.

**Why it happens:**
Webhook order/redelivery and asynchronous workers create race conditions; state is keyed by PR number instead of immutable commit identities.

**How to avoid:**
- Key review state by `(repo_id, pr_number, base_sha, head_sha)` and store a monotonic review sequence.
- Make processing idempotent by `X-GitHub-Delivery` and event payload hash.
- Implement stale-run cancellation: if newer `head_sha` appears, mark current run obsolete and stop publication.
- Add deterministic delta tests for force-push, rebase, and rapid push bursts.

**Warning signs:**
- Duplicate or contradictory comments after force-push.
- Re-review on unchanged head produces different "new issue" set.
- Elevated rate of "comment already addressed" user feedback.

**Phase to address:**
Phase 1 - Event/state machine hardening before enabling incremental mode.

---

### Pitfall 3: Learning Loop Optimizes for User Silence, Not Correctness (P0)

**What goes wrong:**
System interprets comment dismissal or non-action as negative signal and suppresses categories that are hard but valuable (security, concurrency). Noise drops short-term while defect escape rate rises.

**Why it happens:**
Implicit feedback is cheap to collect but highly confounded by workflow pressure, reviewer habits, and policy exceptions.

**How to avoid:**
- Separate telemetry from policy: collect feedback continuously, apply policy changes only through reviewed config updates.
- Require explicit feedback channel for learning (`false_positive`, `not_actionable`, `correct`), keep implicit signals as weak priors.
- Set non-negotiable floors for critical categories (cannot auto-suppress below threshold).
- Add offline replay evaluation before any model/prompt weight update.

**Warning signs:**
- Sharp decline in security findings with no architecture change.
- "Bot got quieter" paired with post-merge bug incidents.
- Large policy shifts from small sample repos.

**Phase to address:**
Phase 4 - Controlled adaptive learning rollout (after metrics and replay harness exist).

---

### Pitfall 4: Cross-Language Normalization Erases Language Semantics (P0)

**What goes wrong:**
Unified pipeline treats all languages identically (same chunking/rules/context windows). Language-specific constructs (Go error patterns, Python async semantics, TS type narrowing, Java nullability) are flattened, causing high false positives and missed defects.

**Why it happens:**
Teams over-prioritize one generic analyzer for speed and underestimate parser/runtime differences.

**How to avoid:**
- Define language profiles: parser strategy, chunk boundaries, rule packs, prompt inserts, and confidence multipliers per language.
- Launch with "supported" vs "best-effort" language tiers; do not market parity until measured.
- Add per-language golden tests and acceptance thresholds before enabling write-path comments.
- Route unsupported syntax to safe fallback (summary-only, no inline assertions).

**Warning signs:**
- One language has 2-3x dismissal rate vs others.
- Frequent comments that misinterpret idiomatic patterns.
- High parse-failure or "unknown node" rates.

**Phase to address:**
Phase 3 - Language profile framework and graduated rollout.

---

### Pitfall 5: Deterministic and Embedding Signals Conflict Without Arbitration (P1)

**What goes wrong:**
Deterministic checks flag issue A, retrieval-assisted LLM recommends opposite action B, both published. Users lose trust because system appears self-contradictory.

**Why it happens:**
Hybrid systems add new signal paths but keep old publication logic; no final conflict resolver or precedence rules.

**How to avoid:**
- Define explicit signal precedence: deterministic safety checks > policy checks > retrieval-LLM suggestions.
- Add arbitration layer that deduplicates and resolves contradictions before publish.
- Require each published finding to include provenance (`deterministic`, `retrieval+llm`, `mixed`).
- Block publish if high-severity contradiction remains unresolved.

**Warning signs:**
- Same file line gets opposing recommendations.
- Reviewer complaints about inconsistent guidance.
- Increased manual dismissals on LLM-only findings.

**Phase to address:**
Phase 2 - Hybrid arbitration before enabling embedding-assisted comments.

---

### Pitfall 6: Retrieval Latency and Cost Blow Past Production SLOs (P1)

**What goes wrong:**
Embedding generation, ANN search, reranking, and larger prompts add enough latency/cost that reviews miss SLA and teams merge before feedback lands.

**Why it happens:**
Feature design optimizes quality in isolation without p95 latency/token budget constraints.

**How to avoid:**
- Set explicit budgets per review (`p95 latency`, `max embedding calls`, `max tokens`).
- Enforce two-stage retrieval cap (cheap candidate fetch, small rerank set).
- Cache by immutable content hash; never re-embed unchanged chunks.
- Use circuit breakers: degrade to deterministic-only mode when budget exceeded.

**Warning signs:**
- p95 latency regression > 50% from pre-v0.5 baseline.
- Cost/review rising faster than PR size growth.
- Timeout/error spikes during large PR bursts.

**Phase to address:**
Phase 2 - Performance guardrails integrated with retrieval implementation.

---

### Pitfall 7: Privacy and Data Boundary Leakage in Embedding Corpus (P1)

**What goes wrong:**
Sensitive code/comments/tokens are embedded and retained without policy controls; cross-repo leakage or non-compliant retention occurs.

**Why it happens:**
Embedding pipelines are often added beside existing review storage, bypassing mature retention and access policy paths.

**How to avoid:**
- Apply repository tenancy boundaries at index and query layers.
- Redact known secret patterns before embedding; store hash+pointer, not raw sensitive literals.
- Enforce TTL and delete propagation for vectors tied to deleted commits/branches.
- Audit-log all retrievals with repo/user context and reason.

**Warning signs:**
- Retrieval surfaces snippets from unrelated repos.
- Vectors remain after source data deletion.
- Security review flags untracked data stores.

**Phase to address:**
Phase 1 - Data governance controls before first embedding write.

---

### Pitfall 8: Evaluation Harness Focuses on LLM Quality, Not Integration Correctness (P1)

**What goes wrong:**
Team validates prompt outputs manually but misses end-to-end failures: wrong SHAs, stale cache, mismatched language parser, publish race, and dedupe bugs.

**Why it happens:**
It is easier to review model output samples than to build deterministic replay tests for pipelines.

**How to avoid:**
- Build replay harness from historical webhook streams with expected publish artifacts.
- Add invariants: idempotent publish, monotonic review sequence, no comments on stale head.
- Track both product metrics (precision proxies) and systems metrics (dedupe misses, stale-run drops).
- Gate phase exits with explicit pass/fail criteria per risk.

**Warning signs:**
- Green model evals but rising production incidents.
- Frequent hotfixes for orchestration/state bugs.
- Inability to reproduce reported misbehavior from logs.

**Phase to address:**
Phase 1 - Verification harness foundation; expanded in each later phase.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store vectors without schema/version metadata | Fast initial launch | Unmigratable index, silent retrieval errors | Never |
| Key review state by PR number only | Simpler state table | Re-review race bugs on force-push/rebase | Never |
| Enable all languages in one release | Faster marketing claim | High dismissal rates, trust collapse | Never |
| Learn from implicit dismissals directly | "Adaptive" behavior quickly | Suppresses critical findings | Never |
| Skip replay harness, rely on canary repo | Less upfront work | Production regressions hard to diagnose | Only for internal prototype, not public rollout |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GitHub webhooks | Processing synchronously and exceeding 10s response window | Ack quickly, queue async processing, dedupe by delivery ID |
| GitHub webhooks | Assuming in-order single delivery semantics | Handle redelivery/out-of-order; state keyed by SHAs and sequence |
| GitHub REST API | Posting too many content writes quickly | Batch where possible, backoff on secondary limits, cap comments |
| Embedding provider API | No retry taxonomy (timeouts vs invalid input vs quota) | Classify errors and apply bounded retries + dead-letter queue |
| Vector store (pgvector or equivalent) | Switching from exact to ANN without recall tracking | Measure recall@k and latency together before ANN cutover |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Re-embedding unchanged files each run | Cost spikes, queue backlog | Cache by content hash, incremental ingest only | ~100+ active PRs/day |
| Large top-k retrieval into prompt | Token and latency blowup | Two-stage retrieval + strict token cap | Medium-large monorepos |
| ANN tuned for speed only | Lower-quality context, noisy comments | Jointly tune recall and latency; keep exact-search benchmark | As corpus grows beyond memory-fit |
| Single worker handling re-reviews serially | Long tail delays on push bursts | Partition queue by repo/PR and support cancellation | Burst pushes / high-concurrency orgs |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Embedding raw secrets or credentials from diffs | Sensitive data retention and exposure | Pre-embedding secret redaction + no-raw-secret storage |
| Cross-tenant retrieval index | Data leakage across organizations/repos | Tenant-scoped indexes and query guards |
| Missing webhook signature/idempotency validation | Replay/duplicate processing and spoofed events | Verify signature, dedupe by delivery ID, expire replay window |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No explanation of "why this was re-reviewed" | Re-review feels random/noisy | Show explicit delta scope (`new commits`, `files changed`) |
| Pretending language parity too early | Users in weaker-language repos lose trust | Label support tiers per language in UI/comments |
| Learning changes behavior silently | Review tone/strictness shifts unexpectedly | Emit changelog note when policy version changes |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Embedding integration:** Model/version metadata enforced on every vector record -- verify retrieval rejects mixed versions.
- [ ] **Incremental re-review:** Force-push/rebase replay tests pass -- verify no stale-head comments are published.
- [ ] **Multi-language support:** Per-language parse success and dismissal thresholds defined -- verify unsupported languages degrade safely.
- [ ] **Learning loop:** No automatic policy mutation from implicit feedback -- verify policy changes require reviewed config release.
- [ ] **Ops controls:** Latency/cost circuit breaker tested -- verify deterministic-only fallback triggers under budget breach.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Embedding index drift | HIGH | Freeze retrieval publish path, rebuild index with correct schema version, replay golden corpus, then gradual re-enable |
| Wrong-baseline incremental review | HIGH | Disable incremental mode, fall back to full deterministic review, repair state from commit graph, replay affected PRs |
| Learning suppression regression | MEDIUM | Roll back to last known-good policy, disable auto-adaptation, reprocess recent PRs in shadow to validate |
| Language rollout regression | MEDIUM | Downgrade affected language to summary-only mode, patch profile/tests, re-enable by canary repos |
| Rate limit/latency incident | MEDIUM | Activate comment cap + degraded mode, apply queue throttling/backoff, clear backlog with priority ordering |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Embedding index drift | Phase 1 (Data contracts) | Migration test proves mixed-version queries are rejected; shadow index recall within threshold |
| Wrong baseline SHA in incremental re-review | Phase 1 (State machine hardening) | Replay suite passes force-push/rebase/out-of-order webhook scenarios |
| Deterministic vs embedding signal conflict | Phase 2 (Hybrid arbitration) | Contradiction test set yields zero unresolved high-severity conflicts |
| Retrieval latency/cost blowups | Phase 2 (Budget guardrails) | p95 latency and cost budgets met for stress corpus; breaker tested |
| Cross-language semantic loss | Phase 3 (Language profiles) | Per-language quality gates met before inline comment enablement |
| Learning loop over-suppression | Phase 4 (Governed adaptation) | Offline replay shows no critical-category suppression beyond floor |
| Privacy/tenant leakage | Phase 1 (Governance controls) | Tenant isolation tests + deletion propagation tests pass |
| Missing integration eval harness | Phase 1 (Replay harness) | CI includes webhook-to-publish deterministic replay gate |

## Prioritized Risk Register (Impact x Probability)

| Priority | Pitfall | Impact | Probability | Why this order |
|----------|---------|--------|-------------|----------------|
| P0 | Wrong baseline SHA in incremental re-review | Very High | High | Corrupts core correctness and creates visible trust damage quickly |
| P0 | Embedding index drift | Very High | High | Silent failure mode; hard to detect without built-in controls |
| P0 | Learning loop optimizes for silence | Very High | Medium-High | Can regress product quality while metrics appear improved |
| P0 | Cross-language semantic loss | High | High | Multi-language rollout magnifies false positives/negatives fast |
| P1 | Deterministic vs embedding conflict | High | Medium | Hybrid contradiction directly harms credibility |
| P1 | Latency/cost budget breach | High | Medium | Operationally painful and causes missed review windows |
| P1 | Privacy/tenant leakage | Very High | Low-Medium | Lower probability with controls, but severe consequence |
| P1 | Weak integration evaluation | High | Medium | Enables all other failures to escape into production |

## Sources

- GitHub Docs - Best practices for using webhooks (`respond within 10 seconds`, delivery handling): https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks (HIGH)
- GitHub Docs - REST API rate limits and secondary limits (`content creation` and backoff behavior): https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api (HIGH)
- pgvector README - exact vs approximate search tradeoff, ANN recall implications, filtering caveats: https://github.com/pgvector/pgvector (MEDIUM-HIGH)
- Tree-sitter docs - parser-driven language handling patterns and language binding model: https://tree-sitter.github.io/tree-sitter/using-parsers (MEDIUM)
- Operational pattern synthesis from deterministic+LLM review system design and migration failure modes (LOW-MEDIUM; validate against your telemetry during Phase 1)

---
*Pitfalls research for: Kodiai v0.5 Advanced Learning & Language Support*
*Researched: 2026-02-12*
