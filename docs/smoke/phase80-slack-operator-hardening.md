# Phase 80 Smoke: Slack Operator Hardening

Run this smoke check before Slack v1 release decisions to prove channel gating,
mention bootstrap behavior, and started-thread follow-up handling are still
enforced by safety rails.

## What This Smoke Verifies

- `SLK80-SMOKE-01` outside-channel payloads are ignored (`outside_kodiai_channel`)
- `SLK80-SMOKE-02` top-level `@kodiai` bootstrap is allowed only with `thread-only` reply targeting
- `SLK80-SMOKE-03` in-thread follow-up is ignored before thread session start
- `SLK80-SMOKE-04` in-thread follow-up is allowed after session start and remains `thread-only`

## Prerequisites

- Run from repository root with Bun installed
- No Slack API token is required; this verifier is deterministic and in-memory

## Command Sequence

1) Optional wiring check:

```sh
bun scripts/phase80-slack-smoke.ts --help
```

2) Run the smoke verifier:

```sh
bun scripts/phase80-slack-smoke.ts
```

## Expected Output

Successful run prints all check IDs as `PASS` and ends with:

```text
Final verdict: PASS - all SLK80-SMOKE-* checks passed.
```

## Blocking Interpretation

- **Release-blocking:** any `SLK80-SMOKE-*` line marked `FAIL` is a hard stop.
- **Pass criteria:** final verdict is `PASS` and process exits with code `0`.
- **Fail criteria:** final verdict is `FAIL` and process exits non-zero with failed check IDs listed.

Always capture as release evidence:

- Full CLI output from `bun scripts/phase80-slack-smoke.ts`
- Final verdict line with all failing check IDs (if any)

If this smoke fails, follow Slack incident triage in
`docs/runbooks/xbmc-ops.md` before rerunning.
