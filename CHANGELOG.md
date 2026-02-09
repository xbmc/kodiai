# Changelog

All notable changes to this project are documented in this file.

## v0.1 (2026-02-09)

Initial shipped milestone.

### Added

- GitHub webhook server (`/webhooks/github`) with signature verification, delivery-id deduplication, and bot filtering
- Job infrastructure: per-installation queue + ephemeral shallow-clone workspaces with cleanup
- Execution engine: Claude Code via Agent SDK `query()` with MCP servers for GitHub interactions
- PR auto-review: inline comments with suggestion blocks, conditional summary comment, silent approvals for clean PRs, fork PR support
- Mention handling: `@kodiai` across issue/PR/review surfaces with tracking comment workflow
- Content safety: sanitization and TOCTOU protections for comment context
- Ops: timeouts and user-visible error reporting, Azure Container Apps deployment script, runbooks
- Review-request reliability: `review_requested` correlation by `deliveryId` and idempotent output publication on redelivery/retry
