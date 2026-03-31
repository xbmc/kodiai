---
estimated_steps: 12
estimated_files: 3
skills_used: []
---

# T01: Remove GITHUB_INSTALLATION_TOKEN from container env, add to APPLICATION_SECRET_NAMES, update tests

Three tightly coupled mutations: (1) add 'GITHUB_INSTALLATION_TOKEN' to APPLICATION_SECRET_NAMES array in aca-launcher.ts, (2) remove githubInstallationToken field from BuildAcaJobSpecOpts interface and the conditional push in buildAcaJobSpec(), (3) remove the getInstallationToken() call and githubInstallationToken prop from the buildAcaJobSpec call in executor.ts, (4) update aca-launcher.test.ts to reflect the new contract.

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

## Inputs

- ``src/jobs/aca-launcher.ts` — source file with APPLICATION_SECRET_NAMES, BuildAcaJobSpecOpts, buildAcaJobSpec()`
- ``src/jobs/aca-launcher.test.ts` — existing tests for the spec builder and APPLICATION_SECRET_NAMES`
- ``src/execution/executor.ts` — sole call site of buildAcaJobSpec() that passes githubInstallationToken`

## Expected Output

- ``src/jobs/aca-launcher.ts` — GITHUB_INSTALLATION_TOKEN added to APPLICATION_SECRET_NAMES; field and push removed`
- ``src/jobs/aca-launcher.test.ts` — updated test assertions matching new contract`
- ``src/execution/executor.ts` — githubInstallationToken prop and getInstallationToken() call removed`

## Verification

bun test ./src/jobs/aca-launcher.test.ts && bun run tsc --noEmit
