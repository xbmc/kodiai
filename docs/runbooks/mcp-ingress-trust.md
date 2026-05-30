# MCP Ingress Trust Model

Use this runbook when reasoning about Kodiai's internal MCP HTTP surface (`/internal/mcp/:serverName`) and what must be enforced outside application code.

## Surface

During review/mention execution, Kodiai registers per-job MCP bearer tokens and exposes tool servers over HTTP on the same Hono app that serves webhooks and health probes. ACA agent jobs call back into this surface to publish GitHub comments, inline reviews, and related write tools.

Implementation references:

- Route mount: `src/index.ts`
- Auth and transport: `src/execution/mcp/http-server.ts`

## Trust boundaries

| Layer | Responsibility |
|---|---|
| Application | Validates `Authorization: Bearer <token>` against an in-memory per-job registry; logs token fingerprints, never raw tokens; rejects missing/expired/retired tokens at info level |
| Network / ingress | Must keep `/internal/mcp/*` off public internet paths; ACA jobs reach the app over private cluster networking |
| Job lifecycle | Tokens are scoped to one execution job and retire when the job completes |
| Repository config | Repo `.kodiai.yml` controls which tools are enabled; disabled tools return structured `TOOL_DISABLED` responses |

## What the app does *not* provide

- IP allowlists or mTLS inside application code
- Cross-installation token reuse
- Persistent MCP credentials beyond job lifetime

## Operator checklist

1. Confirm ACA ingress rules block external access to `/internal/mcp/*`.
2. Confirm agent jobs use the internal base URL configured for the environment (`mcpInternalBaseUrl`).
3. Treat unexpected MCP unauthorized spikes as either expired job retries (bounded info noise) or token leakage/network misconfiguration.
4. Rotate deployment secrets and recycle running jobs if a bearer token may have left the trusted network.

## Related runbooks

- [ACA job debugging](./aca-job-debugging.md)
- [Deploy rollback](./deploy-rollback.md)
- [Key rotation](./key-rotation.md)
