# S02 — kodi-addon-checker subprocess and output parsing

**Date:** 2026-03-28

## Summary

S02 builds the subprocess runner and output parser that transform the current scaffold (which just logs addon IDs) into a real checker that produces structured findings. The work splits cleanly into two units: (1) a new pure library module `src/lib/addon-checker-runner.ts` covering subprocess invocation, ANSI stripping, line parsing, and branch validation, and (2) wiring changes to `src/handlers/addon-check.ts` and `src/index.ts` that add `workspaceManager` + `jobQueue` to the handler and call the runner per addon.

The biggest technical risk is the `kodi-addon-checker` startup behavior: `get_all_repo_addons()` fires unconditionally in `main()` and makes HTTP requests to `mirrors.kodi.tv` for all 10 Kodi branches (30-second timeout per branch, with retry backoff). This means the first subprocess call can take 10–30 seconds on a live network before any checks run. This is acceptable for production (network available, timeout is a hard upper bound), but makes testing via real subprocess impractical. Tests must mock the subprocess via the `__runSubprocessForTests` injection pattern established in `src/lib/usage-analyzer.ts`.

The output format is stable and simple: the console reporter (enabled by default) calls `print()` on each `Record` object, producing `ANSI_COLOR + "LEVEL: message" + ANSI_RESET` on stdout. LEVEL is exactly `ERROR`, `WARN`, or `INFO`. Exit code is 1 when any ERROR is found, 0 otherwise. Strip ANSI codes with a regex and parse with `/^(ERROR|WARN|INFO): (.+)$/`.

## Recommendation

Create `src/lib/addon-checker-runner.ts` as a pure module with injectable subprocess function — same pattern as `analyzePackageUsage` in `src/lib/usage-analyzer.ts`. Expose:
- `AddonFinding` type: `{ level: "ERROR" | "WARN" | "INFO"; addonId: string; message: string }`
- `parseCheckerOutput(raw: string, addonId: string): AddonFinding[]` — ANSI strip + line parse
- `resolveCheckerBranch(baseBranch: string): string | null` — validates against the 10 known ValidKodiVersions; null = unknown branch (skip with warning)
- `runAddonChecker(opts): Promise<AddonCheckerResult>` — wraps the subprocess with `withTimeBudget`, fail-open on tool-not-found or timeout

Then update `createAddonCheckHandler` to accept `workspaceManager` and `jobQueue`, clone the PR head ref, call the runner per addon, log findings at `info` level with structured bindings. Update `src/index.ts` to pass these deps.

## Implementation Landscape

### Key Files

- `src/lib/addon-checker-runner.ts` — **new**; pure subprocess + parser module. No side effects. Exports types and functions. Uses `withTimeBudget` from `./usage-analyzer.ts` for the timeout mechanism.
- `src/lib/addon-checker-runner.test.ts` — **new**; unit tests for parser, branch resolver, and runner (with injected subprocess mock).
- `src/lib/usage-analyzer.ts` — **read-only reference**; provides `withTimeBudget` (re-export/import), establishes the `__runXxxForTests` injection pattern, and shows the `timeBudgetMs` + `timedOut` fail-open shape to follow.
- `src/handlers/addon-check.ts` — **modify**; add `workspaceManager: WorkspaceManager` and `jobQueue: JobQueue` to deps, add `pull_request.base.ref` to the payload type cast, clone workspace, call runner per addon, replace scaffold log with real findings log.
- `src/handlers/addon-check.test.ts` — **modify**; add tests for workspace clone invocation and runner results (inject mock runner via `__runSubprocessForTests`).
- `src/index.ts` — **modify**; pass `workspaceManager` and `jobQueue` to `createAddonCheckHandler`.

### Build Order

1. **`src/lib/addon-checker-runner.ts` first** — pure module, no handler dependency. Can be built and tested in isolation. Contains all parsing and subprocess logic. Tests prove parsing correctness and fail-open behavior without touching the handler.
2. **`src/handlers/addon-check.ts` second** — wires the runner into the handler. Depends on T01 delivering the runner type. Tests extend the existing 5-test suite.
3. **`src/index.ts` last** — one-liner change to add `workspaceManager` and `jobQueue` to the handler invocation. Verified by `bun run tsc --noEmit` exit 0.

### Verification Approach

```bash
# Unit tests for runner (pure, no subprocess needed):
bun test src/lib/addon-checker-runner.test.ts

# Unit tests for handler (with mocked runner):
bun test src/handlers/addon-check.test.ts

# Type check — must exit 0:
bun run tsc --noEmit
```

The test suite should demonstrate:
- `parseCheckerOutput` correctly strips ANSI escape codes and classifies `ERROR`, `WARN`, `INFO` lines
- `parseCheckerOutput` ignores non-matching lines (XML schema errors, blank lines, debug output)
- `resolveCheckerBranch` returns the branch name for known versions, null for unknown ones
- `runAddonChecker` returns `{ timedOut: true, findings: [] }` when the injected subprocess exceeds budget
- `runAddonChecker` returns `{ toolNotFound: true, findings: [] }` when the subprocess exits with ENOENT
- Handler calls `workspaceManager.create` with the PR head ref and cleans up after
- Handler skips (logs warn) when `resolveCheckerBranch` returns null

## Common Pitfalls

- **Network hang in real subprocess** — `kodi-addon-checker` calls `get_all_repo_addons()` unconditionally, downloading all 10 branches from `mirrors.kodi.tv`. Use `__runSubprocessForTests` injection in tests; never call the real subprocess in unit tests. In production use `withTimeBudget` with a generous timeout (e.g., 120s).
- **ANSI escape codes in output** — the console reporter wraps every line with `\033[NNm...\033[0m`. Strip before parsing. Pattern: `/\x1B\[[0-9;]*m/g`.
- **Checker writes a log file** — `kodi-addon-checker` writes `kodi-addon-checker.log` to `cwd`. Run the subprocess with `cwd` set to the addon directory (or workspace tmpdir) so the log file goes into the workspace, which is cleaned up automatically.
- **Exit code 1 on ERROR** — the tool exits 1 when there are problems, 0 on clean or warning-only. Do NOT treat non-zero exit as a subprocess failure — parse stdout regardless of exit code.
- **`--skip-dependency-checks` does NOT skip the addon list download** — this flag skips dependency availability checks within the check run, but the `get_all_repo_addons()` download still happens. Don't rely on it to speed up the subprocess.
- **Branch name injection risk** — the PR `base.ref` comes from untrusted webhook payload. Always validate against the known `ValidKodiVersions` list before passing to the subprocess. `resolveCheckerBranch` handles this.
- **PR payload type** — the current handler casts payload to a minimal inline type missing `pull_request.base.ref`. The cast must be extended: `pull_request?: { number: number; base?: { ref: string }; head?: { ref: string } }`.
- **Pre-existing tsc errors** — S01 cleaned all tsc errors. S02 must not reintroduce any. After implementing, `bun run tsc --noEmit` must exit 0.

## Open Risks

- If the workspace is cloned to the base branch (not the PR head), the addon directory may not contain the PR changes. The handler needs to clone the head branch (from `pull_request.head.ref`) and optionally use `fetchAndCheckoutPullRequestHeadRef` for fork PRs. This mirrors the strategy in `src/handlers/review.ts` (lines 1178–1205). For non-fork PRs, `head.ref` directly; for fork PRs, clone base and fetch `pull/${prNumber}/head`. For S02 simplicity, clone the base branch then fetch the PR head ref using `fetchAndCheckoutPullRequestHeadRef` — same approach review.ts uses.
- Subprocess timeout value: 120s covers the worst-case network download (~30s per branch × 10 branches, but with connection pooling it's much faster). Make this configurable as `opts.timeoutMs` with a default.
