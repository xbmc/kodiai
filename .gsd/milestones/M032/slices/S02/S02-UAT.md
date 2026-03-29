# S02: MCP HTTP Server in Orchestrator — UAT

**Milestone:** M032
**Written:** 2026-03-29T18:46:28.833Z

# S02 UAT: MCP HTTP Server in Orchestrator

## Preconditions

1. Orchestrator is running locally: `bun run src/index.ts` (or test harness)
2. `PORT` env var set (e.g. 3000)
3. A bearer token has been registered via `mcpJobRegistry.register(token, { github_comment: factory }, ttlMs)`
4. The token is known as `VALID_TOKEN` for the test steps below
5. An invalid token `WRONG_TOKEN` is any 32-char hex string not in the registry

---

## Test Cases

### TC-01: No Authorization header → 401

**Steps:**
```
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:PORT/internal/mcp/github_comment
```
**Expected:** HTTP 401

---

### TC-02: Wrong token → 401

**Steps:**
```
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer WRONG_TOKEN" \
  http://localhost:PORT/internal/mcp/github_comment
```
**Expected:** HTTP 401

---

### TC-03: Valid token + unknown server name → 404

**Steps:**
```
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer VALID_TOKEN" \
  http://localhost:PORT/internal/mcp/nonexistent_server
```
**Expected:** HTTP 404

---

### TC-04: Valid token + registered server + MCP initialize → 200 with MCP result

**Steps:**
```
curl -s \
  -H "Authorization: Bearer VALID_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -X POST \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' \
  http://localhost:PORT/internal/mcp/github_comment
```
**Expected:** HTTP 200. Response body is JSON containing `"result"` and `"capabilities"` keys.

---

### TC-05: All 7 registered MCP server names respond (not 404)

**Steps:** For each of the 7 MCP server names registered in S03 (e.g., `github_comment`, `inline_review`, `review_comment_thread`, `issue_comment`, `ci_status`, `issue_label`, `checkpoint`), send an MCP initialize request with valid token.

**Expected:** Each returns HTTP 200 (not 404). Individual tool schemas may vary.

---

### TC-06: Token expiry — expired token → 401

**Steps:**
1. Register a token with `ttlMs = 100` (100ms TTL)
2. Wait 200ms
3. Send request with the expired token
**Expected:** HTTP 401 (lazy expiry removes the entry on first access after expiry)

---

### TC-07: Unregister removes access

**Steps:**
1. Register `VALID_TOKEN` with factories
2. Verify TC-04 passes (200 response)
3. Call `mcpJobRegistry.unregister(VALID_TOKEN)`
4. Re-send the same request
**Expected:** HTTP 401

---

### TC-08: MCP_BASE_URL present in ACA job spec

**Steps:**
```ts
import { buildAcaJobSpec } from "./src/jobs/aca-launcher.ts";
const spec = buildAcaJobSpec({ mcpBaseUrl: "http://ca-kodiai.internal.env.eastus.azurecontainerapps.io", ... });
const entry = spec.env.find(e => e.name === "MCP_BASE_URL");
console.assert(entry?.value === "http://ca-kodiai.internal.env.eastus.azurecontainerapps.io");
```
**Expected:** `MCP_BASE_URL` env entry is present with the supplied value. No APPLICATION_SECRET_NAMES guard throws.

---

### TC-09: Automated test suite passes

```
bun test ./src/execution/mcp/http-server.test.ts
bun test ./src/jobs/aca-launcher.test.ts
bun run tsc --noEmit
```
**Expected:** 10 pass + 18 pass, 0 fail total; tsc exits 0.

