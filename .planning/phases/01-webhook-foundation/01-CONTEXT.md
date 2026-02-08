# Phase 1: Webhook Foundation - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

The server receives GitHub webhook events, verifies their authenticity, authenticates as a GitHub App, and routes events to the correct handlers — while filtering bot-generated noise and processing asynchronously to avoid webhook timeouts. Job execution, repo cloning, and Claude invocation are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Server & framework
- Framework choice is Claude's discretion (Hono, Elysia, or raw Bun.serve — pick best fit)
- Route organization is Claude's discretion (single file vs by-concern — pick based on endpoint count)
- Endpoints: `/webhooks/github`, `/health` (liveness), and `/readiness` (checks GitHub API connectivity)
- Logging: structured JSON to stdout (e.g., pino or similar). No pretty-print mode — JSON always.
- Fail fast on startup if required config is missing (app ID, private key, webhook secret)

### Webhook processing model
- Acknowledge webhooks immediately (return 200), process asynchronously — exact async pattern is Claude's discretion
- Deduplicate redeliveries using `X-GitHub-Delivery` header — track delivery IDs to skip duplicates
- Log signature verification failures as warning/error severity (should stand out in logs for potential alerting)
- Accept all GitHub event types — silently drop unhandled event types with no error

### Event routing design
- Explicit handler registry — central map of event type + action to handler function(s)
- Multiple handlers per event type supported (e.g., logging handler + processing handler)
- Handler errors are isolated — one handler's failure doesn't affect other handlers for the same event
- Bot filtering: filter all bot accounts by default, with a configurable allow-list for specific bots to pass through
- The app's own account is always filtered (not configurable)

### Auth token management
- Cache installation access tokens in memory with TTL-based refresh before expiry (~1 hour tokens)
- Token cache keyed by installation ID — multi-installation support from day one
- Private key loading supports both: inline PEM in environment variable OR file path from env var
- All required secrets validated on startup — crash immediately if anything is missing

### Claude's Discretion
- HTTP framework selection (Hono, Elysia, or Bun.serve)
- Route file organization
- Async processing pattern (in-memory queue vs fire-and-forget vs other)
- Delivery ID deduplication storage strategy (in-memory map, LRU cache, etc.)
- Exact structured logging library choice

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-webhook-foundation*
*Context gathered: 2026-02-07*
