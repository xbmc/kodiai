# S01 Research: Remove GITHUB_INSTALLATION_TOKEN from container env

## Summary

This is light, surgical work — three targeted changes to two files, plus test updates. The codebase is well-understood and the patterns are already established. No new libraries, no architectural decisions.

## Recommendation

Execute as a single task: mutate `aca-launcher.ts` and `aca-launcher.test.ts` together. The changes are tightly coupled and small enough to fit comfortably in one context window.

## Implementation Landscape

### Files to change

**`src/jobs/aca-launcher.ts`**

Current state:
- `APPLICATION_SECRET_NAMES` array (lines 36–46): does NOT include `GITHUB_INSTALLATION_TOKEN`
- `BuildAcaJobSpecOpts` interface (line 56): has `githubInstallationToken?: string` field
- `buildAcaJobSpec()` function (line 69): pushes `GITHUB_INSTALLATION_TOKEN` into env when `opts.githubInstallationToken !== undefined` (lines 81–83)

Required changes:
1. Add `"GITHUB_INSTALLATION_TOKEN"` to the `APPLICATION_SECRET_NAMES` array — this makes the removal self-enforcing; any future attempt to re-add it via the API would throw at runtime
2. Remove `githubInstallationToken?: string` from `BuildAcaJobSpecOpts` interface
3. Remove the `if (opts.githubInstallationToken !== undefined)` block from `buildAcaJobSpec()`

**`src/execution/executor.ts`**

Current state (lines 219–231): calls `buildAcaJobSpec({ ..., githubInstallationToken: await githubApp.getInstallationToken(context.installationId) })`. This is the sole call site.

Required change: Remove the `githubInstallationToken: await githubApp.getInstallationToken(context.installationId)` line. The `getInstallationToken()` call can be dropped entirely — the result is no longer used.

**`src/jobs/aca-launcher.test.ts`**

Current test state — two tests need updating:

1. **"GITHUB_INSTALLATION_TOKEN included when provided"** (line ~91): Tests that the token IS included when passed. This test must be replaced with one asserting `GITHUB_INSTALLATION_TOKEN` is in `APPLICATION_SECRET_NAMES`.

2. **"GITHUB_INSTALLATION_TOKEN absent when not provided"** (line ~97): Tests the absent case. This can be updated to assert `GITHUB_INSTALLATION_TOKEN` is absent unconditionally (not just when omitted), and optionally that passing it would trigger the security guard.

3. **`APPLICATION_SECRET_NAMES` "contains the expected secret key names"** test (line ~23): Must be updated to include `"GITHUB_INSTALLATION_TOKEN"` in the expected array.

### What does NOT change

- `src/execution/executor.ts` line for `anthropicApiKey` — `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` remain in the job env (required for SDK auth, out of scope per M033 context)
- The `scanOutgoingForSecrets` function — scope belongs to S02
- `buildSecurityPolicySection` — scope belongs to S03
- The `cancelAcaJob`, `pollUntilComplete`, `readJobResult` tests — unchanged

### Runtime guard behaviour post-change

After adding `GITHUB_INSTALLATION_TOKEN` to `APPLICATION_SECRET_NAMES`, the existing runtime guard at the bottom of `buildAcaJobSpec()` will automatically throw if any future caller attempts to inject it. Since the `githubInstallationToken` field is removed from the opts interface, TypeScript will catch it at compile time too — defense in depth.

## Verification

```
bun test ./src/jobs/aca-launcher.test.ts
```

Expected: all tests pass. `GITHUB_INSTALLATION_TOKEN` absent from spec env array; `APPLICATION_SECRET_NAMES` includes it.

Also run:
```
bun run tsc --noEmit
```

To confirm no TypeScript errors from removing the field from `BuildAcaJobSpecOpts` (executor.ts reference must be cleaned up first).

## Constraints and Risks

- **Zero functional impact**: confirmed by grep — `GITHUB_INSTALLATION_TOKEN` is not read anywhere in `agent-entrypoint.ts` or any agent-side code. The agent container never consumed it.
- **Single call site**: `executor.ts` line 227 is the only place that passes `githubInstallationToken`. After removing it, the `await githubApp.getInstallationToken(...)` call becomes dead code and should be dropped to avoid unnecessary API calls.
- **No test infrastructure changes**: tests use `buildAcaJobSpec` directly with inline opts, no mocking complexity.
