---
estimated_steps: 17
estimated_files: 1
skills_used: []
---

# T02: Wire createAddonCheckHandler into src/index.ts and verify TypeScript compiles

Import and call createAddonCheckHandler in src/index.ts, passing the minimal deps (eventRouter, githubApp, config, logger). Verify the full TypeScript compilation passes.

### Steps

1. In `src/index.ts`, add the import:
   ```ts
   import { createAddonCheckHandler } from "./handlers/addon-check.ts";
   ```

2. Find the handler registration block (around line 411-441 where createIssueOpenedHandler etc. are called). Add after the existing handler registrations:
   ```ts
   createAddonCheckHandler({
     eventRouter,
     githubApp,
     config,
     logger,
   });
   ```
   Note: no jobQueue, workspaceManager, or sql needed — the handler only needs octokit for listFiles.

3. Run `bun run tsc --noEmit` to verify types are correct end-to-end. Fix any issues (likely none given the factory signature is explicit).

## Inputs

- ``src/handlers/addon-check.ts` — createAddonCheckHandler export from T01`
- ``src/index.ts` — existing handler registration block to extend`

## Expected Output

- ``src/index.ts` — modified: import and call for createAddonCheckHandler added`

## Verification

bun run tsc --noEmit
