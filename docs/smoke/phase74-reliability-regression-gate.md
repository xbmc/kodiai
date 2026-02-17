# Phase 74 Smoke: Reliability Regression Gate

Run this gate once per pre-release cycle to block promotion when issue write-mode
reliability or combined degraded-retrieval behavior regresses.

## What This Gate Locks

- Azure runtime capability prerequisites for `xbmc/xbmc`:
  - `CAP-74-01` branch creation prerequisites
  - `CAP-74-02` bot-branch push prerequisites
  - `CAP-74-03` PR creation prerequisites
- Issue write-mode reliability contract:
  - `REL-74-01` machine-checkable status parsing
  - `REL-74-02` failed-step diagnostics for failures
  - `REL-74-03` non-ambiguous diagnostics (fallback included)
  - `REL-74-04` success artifact triad (branch push + PR URL + issue linkback)
- Combined degraded retrieval assertions in the same scenario:
  - `RET-74-01` bounded rendered retrieval section (`renderedChars <= maxChars`)
  - `RET-74-02` markdown-safe fallback rendering

## Required Inputs

Prepare one scenario evidence JSON file (example: `./tmp/phase74-scenario.json`) with
combined issue-write and retrieval evidence from the same deterministic run.

```json
{
  "scenarioName": "phase74-release-check",
  "issueWriteReply": "status: pr_creation_failed\nfailed_step: create-pr\ndiagnostics: Resource not accessible by integration",
  "artifacts": {
    "branchPush": true,
    "prUrl": "https://github.com/xbmc/xbmc/pull/123",
    "issueLinkbackUrl": "https://github.com/xbmc/xbmc/issues/27874#issuecomment-1"
  },
  "retrieval": {
    "maxChars": 1200,
    "renderedChars": 842,
    "fallbackText": "- [major/reliability] src/file.ts -- fallback evidence"
  }
}
```

Optional: use `--capabilities <path>` to provide deterministic fixture capability
data when running outside authenticated Azure runtime.

## Command Sequence

1) Verify CLI wiring:

```sh
bun run verify:phase74 --help
```

2) Run the deterministic gate:

```sh
bun run verify:phase74 \
  --owner xbmc \
  --repo xbmc \
  --scenario ./tmp/phase74-scenario.json
```

3) Optional machine-readable output:

```sh
bun run verify:phase74 \
  --owner xbmc \
  --repo xbmc \
  --scenario ./tmp/phase74-scenario.json \
  --json
```

## Blocking Interpretation

- **Release-blocking:** any failed check ID (`CAP-74-*`, `REL-74-*`, `RET-74-*`) is a hard stop.
- **Pass criteria:** final verdict is `PASS` and process exits with code `0`.
- **Fail criteria:** final verdict is `FAIL` and process exits non-zero with failed check IDs listed.

Always capture and attach to release evidence:

- Full gate output (text or JSON)
- Failed-step/status line from issue write reply when present
- All failing check IDs from final verdict

If this gate fails, resolve the mapped failure path in `docs/runbooks/xbmc-ops.md`
before rerunning.
