---
estimated_steps: 26
estimated_files: 2
skills_used: []
---

# T01: Make checkpoint persistence acknowledgements truthful

Patch the MCP checkpoint tool so it does not claim durable progress before the write has actually completed. This task closes owned requirement R075 and removes the false-success path that would otherwise undermine every later continuation-family proof in this slice.

## Steps
1. Read `createCheckpointServer` and update `save_review_checkpoint` so it awaits `knowledgeStore.saveCheckpoint(...)`, preserves the existing degraded-storage branch, and routes rejected saves through the existing `isError` response path instead of returning optimistic success JSON.
2. Expand `src/execution/mcp/checkpoint-server.test.ts` with one test that proves the handler promise stays pending until an async `saveCheckpoint` resolver is released, and a second negative-path test that proves a rejected save does not return `saved: true`.
3. Keep the tool contract narrow: do not add new MCP tools or schema fields unless the current response shape cannot express truthful failure.

## Must-Haves
- [ ] `save_review_checkpoint` only returns `saved: true` after the awaited checkpoint write resolves.
- [ ] A rejected checkpoint write returns a non-success/error response and never reports false durability.
- [ ] Existing unavailable-storage degradation behavior remains intact.

## Verification
- `bun test src/execution/mcp/checkpoint-server.test.ts`
- Handler-level async test proves the tool promise does not resolve before the checkpoint write finishes.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `knowledgeStore.saveCheckpoint` | Return MCP tool error / non-success result; do not claim saved | Leave tool call unresolved until runtime timeout rather than fabricating success | N/A — local function call |

## Negative Tests
- **Malformed inputs**: Reuse tool schema validation; no new malformed-input surface is added.
- **Error paths**: Rejected `saveCheckpoint` promise returns an error result and does not increment success assertions.
- **Boundary conditions**: Deferred promise test proves success is emitted only after the async write settles.

## Inputs
- `src/execution/mcp/checkpoint-server.ts` — current non-awaited checkpoint tool implementation.
- `src/execution/mcp/checkpoint-server.test.ts` — existing positive-path-only MCP checkpoint tests.

## Expected Output
- `src/execution/mcp/checkpoint-server.ts` — awaited, truthful checkpoint persistence acknowledgement.
- `src/execution/mcp/checkpoint-server.test.ts` — async-resolution and rejection regression coverage.

## Inputs

- ``src/execution/mcp/checkpoint-server.ts``
- ``src/execution/mcp/checkpoint-server.test.ts``

## Expected Output

- ``src/execution/mcp/checkpoint-server.ts``
- ``src/execution/mcp/checkpoint-server.test.ts``

## Verification

bun test src/execution/mcp/checkpoint-server.test.ts

## Observability Impact

Makes the checkpoint tool's success signal itself trustworthy so later canonical/projection diagnostics are not built on a false durable-save acknowledgement.
