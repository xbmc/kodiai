# S05: Write Pipeline

**Goal:** Enable mention-driven changes end-to-end by letting the model edit files, while keeping branch/commit/push/PR creation in trusted code.
**Demo:** Enable mention-driven changes end-to-end by letting the model edit files, while keeping branch/commit/push/PR creation in trusted code.

## Must-Haves


## Tasks

- [x] **T01: 15-write-pipeline 01** `est:20 min`
  - Enable mention-driven changes end-to-end by letting the model edit files, while keeping branch/commit/push/PR creation in trusted code.

This phase does NOT add broad policy guardrails (path allow/deny, secret scanning) beyond existing safety primitives; those are Phase 16.

## Files Likely Touched

- `src/execution/executor.ts`
- `src/execution/types.ts`
- `src/execution/mcp/index.ts`
- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
