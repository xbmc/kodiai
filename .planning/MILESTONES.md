# Milestones

## v1.0 MVP (Shipped: 2026-02-09)

**Scope:** 10 phases, 27 plans

**Key accomplishments:**
- GitHub webhook foundation: signature verification, delivery dedup, bot filtering, and async dispatch
- Job infrastructure: per-installation concurrency + ephemeral shallow-clone workspaces with cleanup
- Execution engine: Claude Code CLI via Agent SDK with MCP servers for GitHub interactions
- PR auto-review: inline diff comments with suggestions, fork PR support, and silent approvals for clean PRs
- Mention handling: @kodiai across issue/PR/review surfaces with tracking comment workflow
- Production deployment: Docker + Azure Container Apps, probes/secrets, operational runbooks, and review_requested idempotency hardening

---
