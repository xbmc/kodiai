# S02: MCP HTTP Server in Orchestrator

**Goal:** Expose all 7 MCP servers over authenticated Hono HTTP routes under /internal/mcp/* with per-job bearer token auth. Per-job token map with TTL cleanup. Stateless request-per-call transport using WebStandardStreamableHTTPServerTransport.
**Demo:** After this: After S02: curl -H 'Authorization: Bearer <valid-token>' http://localhost:PORT/internal/mcp/github_comment → MCP JSON response; same curl without token → 401; wrong token → 401. All 7 server routes respond.

## Tasks
