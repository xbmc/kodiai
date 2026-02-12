# Milestones

## v0.1 MVP (Shipped: 2026-02-09)

**Scope:** 10 phases, 27 plans

**Key accomplishments:**
- GitHub webhook foundation: signature verification, delivery dedup, bot filtering, and async dispatch
- Job infrastructure: per-installation concurrency + ephemeral shallow-clone workspaces with cleanup
- Execution engine: Claude Code CLI via Agent SDK with MCP servers for GitHub interactions
- PR auto-review: inline diff comments with suggestions, fork PR support, and silent approvals for clean PRs
- Mention handling: @kodiai across issue/PR/review surfaces with tracking comment workflow
- Production deployment: Docker + Azure Container Apps, probes/secrets, operational runbooks, and review_requested idempotency hardening

---

## v0.3 Configuration & Observability (Shipped: 2026-02-11)

**Scope:** 4 phases (22-25), 7 plans

**Key accomplishments:**
- Forward-compatible config parsing with graceful section-level degradation and structured warnings
- Persistent telemetry storage with SQLite WAL mode, 90-day retention, and concurrent read/write safety
- Fire-and-forget telemetry capture pipeline recording every execution (tokens, cost, duration, model)
- Enhanced config controls: review/mention/write-mode guardrails, telemetry opt-out, cost warning thresholds
- CLI reporting tool with time/repo filtering and multiple output formats (table/JSON/CSV)
- Deployment-ready infrastructure with /app/data directory and automatic startup maintenance

---


## v0.4 Intelligent Review System (Shipped: 2026-02-12)

**Scope:** 4 phases (26-29), 17 plans

**Key accomplishments:**
- Configurable review strictness with mode, severity floor, focus areas, and enforced comment caps
- Context-aware reviews with deterministic diff analysis, path-scoped instructions, and profile presets
- Persistent knowledge store and explicit learning controls (suppressions, confidence thresholds, Review Details metrics)
- Runtime output filtering that removes suppressed/low-confidence inline findings while preserving deterministic reporting
- Reaction-based feedback capture linked to stored findings with idempotent per-repo persistence

---
