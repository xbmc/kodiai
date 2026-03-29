---
estimated_steps: 32
estimated_files: 4
skills_used: []
---

# T02: Wire mcpBaseUrl into aca-launcher, add config fields, mount routes in index.ts

Integrate the MCP HTTP server into the orchestrator startup and the ACA job spec builder.

**Steps:**

1. **`src/jobs/aca-launcher.ts`** — add `mcpBaseUrl: string` to `BuildAcaJobSpecOpts` and inject it into the job env array as `{ name: "MCP_BASE_URL", value: opts.mcpBaseUrl }`. Place it between the existing required env entries. Note: `MCP_BASE_URL` is NOT in `APPLICATION_SECRET_NAMES`, so the runtime guard will not fire.

2. **`src/jobs/aca-launcher.test.ts`** — update the `BASE_OPTS` fixture (and any other test fixtures that construct `BuildAcaJobSpecOpts`) to include `mcpBaseUrl: "http://ca-kodiai.internal.env.eastus.azurecontainerapps.io"`. Add a test: `MCP_BASE_URL env var present in spec` asserting `spec.env.find(e => e.name === 'MCP_BASE_URL')?.value === opts.mcpBaseUrl`. Also verify `MCP_BASE_URL` is not in `APPLICATION_SECRET_NAMES` (it shouldn't be — confirm the guard doesn't fire).

3. **`src/config.ts`** — add two optional fields to `configSchema`:
```ts
mcpInternalBaseUrl: z.string().default(""),
acaJobImage: z.string().default(""),
```
And in `loadConfig`'s parse input:
```ts
mcpInternalBaseUrl: process.env.MCP_INTERNAL_BASE_URL,
acaJobImage: process.env.ACA_JOB_IMAGE,
```
Using `.default("")` means existing test stubs that construct `AppConfig` directly don't need updating (Zod fills the default).

4. **`src/index.ts`** — add:
```ts
import { createMcpJobRegistry } from "./execution/mcp/http-server.ts";
import { createMcpHttpRoutes } from "./execution/mcp/http-server.ts";
```
Near the start of the app section, create the registry:
```ts
const mcpJobRegistry = createMcpJobRegistry();
```
Mount the routes on the Hono app (before the catch-all error handler):
```ts
app.route("/internal", createMcpHttpRoutes(mcpJobRegistry, logger));
```
The registry is module-level so S03 can import it or receive it via dependency injection.

5. Export `mcpJobRegistry` from `src/index.ts` is NOT necessary — S03 will wire it via the executor factory. Just create it as a local variable passed to `createMcpHttpRoutes`.

6. Run `bun test ./src/jobs/aca-launcher.test.ts` and fix until all pass.
7. Run `bun run tsc --noEmit` — fix any errors (particularly AppConfig stubs in test files that may need the new optional fields, though `.default("")` in Zod should make them optional in parsed output).

## Inputs

- `src/execution/mcp/http-server.ts`
- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `src/config.ts`
- `src/index.ts`

## Expected Output

- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `src/config.ts`
- `src/index.ts`

## Verification

bun test ./src/jobs/aca-launcher.test.ts && bun run tsc --noEmit
