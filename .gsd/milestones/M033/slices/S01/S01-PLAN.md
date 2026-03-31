# S01: Remove GITHUB_INSTALLATION_TOKEN from container env

**Goal:** Remove GITHUB_INSTALLATION_TOKEN from the ACA job env array — add it to APPLICATION_SECRET_NAMES as a permanent enforcement mechanism, drop it from BuildAcaJobSpecOpts, remove the push from buildAcaJobSpec(), and remove the now-dead call site in executor.ts.
**Demo:** After this: bun test ./src/jobs/aca-launcher.test.ts passes; GITHUB_INSTALLATION_TOKEN absent from test spec env array; APPLICATION_SECRET_NAMES includes it.

## Tasks
- [x] **T01: Added GITHUB_INSTALLATION_TOKEN to APPLICATION_SECRET_NAMES, removed it from BuildAcaJobSpecOpts/buildAcaJobSpec, and dropped the dead getInstallationToken call from executor.ts** — Three tightly coupled mutations: (1) add 'GITHUB_INSTALLATION_TOKEN' to APPLICATION_SECRET_NAMES array in aca-launcher.ts, (2) remove githubInstallationToken field from BuildAcaJobSpecOpts interface and the conditional push in buildAcaJobSpec(), (3) remove the getInstallationToken() call and githubInstallationToken prop from the buildAcaJobSpec call in executor.ts, (4) update aca-launcher.test.ts to reflect the new contract.

Specific steps:
1. In `src/jobs/aca-launcher.ts`: add `"GITHUB_INSTALLATION_TOKEN"` to the `APPLICATION_SECRET_NAMES` array (after `"BOT_USER_PAT"`).
2. In `src/jobs/aca-launcher.ts`: remove `githubInstallationToken?: string` from `BuildAcaJobSpecOpts`.
3. In `src/jobs/aca-launcher.ts`: remove the `if (opts.githubInstallationToken !== undefined)` block (lines ~89-91) from `buildAcaJobSpec()`.
4. In `src/execution/executor.ts`: remove `githubInstallationToken: await githubApp.getInstallationToken(context.installationId)` from the `buildAcaJobSpec(...)` call (line ~227). The `getInstallationToken` call becomes dead code — drop it entirely.
5. In `src/jobs/aca-launcher.test.ts`:
   a. Update the `'contains the expected secret key names'` test to include `'GITHUB_INSTALLATION_TOKEN'` in the expected array.
   b. Replace the `'GITHUB_INSTALLATION_TOKEN included when provided'` test with one that asserts `APPLICATION_SECRET_NAMES` contains `'GITHUB_INSTALLATION_TOKEN'` (the old 'included' test is now invalid — passing it to buildAcaJobSpec would cause a runtime throw).
   c. Update `'GITHUB_INSTALLATION_TOKEN absent when not provided'` to assert it's always absent from a normal spec (no longer conditional on the opt being omitted — the field doesn't exist).
6. Run `bun test ./src/jobs/aca-launcher.test.ts` — all tests must pass.
7. Run `bun run tsc --noEmit` — must exit 0.
  - Estimate: 30m
  - Files: src/jobs/aca-launcher.ts, src/jobs/aca-launcher.test.ts, src/execution/executor.ts
  - Verify: bun test ./src/jobs/aca-launcher.test.ts && bun run tsc --noEmit
