# M075 Final Production Proof

Generated: `2026-05-20T18:21:38.350Z`

This artifact is the final bounded proof record for M075/S07. It intentionally contains only verifier status codes, check ids, bounded counts, source availability, health/readiness statuses, package wiring, and command exit codes. It does not include raw Log Analytics rows, raw `Log_s` payloads, prompts, model output, candidate bodies, diffs, tokens, secrets, GitHub API payloads, stack traces, or workspace paths.

## Operator commands

Use these two aggregate commands as the primary proof surface:

```sh
bun run verify:m075 -- --json
bun run verify:m075 -- --live --json
```

For blocked live environments where the operator needs a JSON report artifact without treating it as proof success, use:

```sh
bun run verify:m075 -- --live --allow-blocked --json
```

`--allow-blocked` only changes the process exit code for blocked live configuration. The JSON report remains `success: false` with `statusCode: m075_live_blocked` and must not validate R156.

## Current proof verdict

- Local aggregate proof: **passed**.
- Critical S01-S06 verifier proof: **passed**.
- Negative verifier tests: **passed**.
- Live production proof: **blocked**, not failed by regression evidence.
- R156 validation: **not validated** because live source configuration was unavailable.

The live report is blocked on `health.source.blocked`; Log Analytics collection was intentionally skipped, so the zero live row counts below mean "not queried" rather than "production cleanup proven".

## Command evidence

| Command | Exit code | Verdict | Bounded result |
|---|---:|---|---|
| `bun run verify:m075 -- --json` | 0 | pass | `success=true`, `statusCode=m075_ok`, `failedCheckIds=[]`, children passed `6/6` |
| `bun run verify:m075 -- --live --json` | 1 | blocked | `success=false`, `statusCode=m075_live_blocked`, blocked ids: `health.source.blocked`, `live-log-source.blocked`, `live-redaction.safe`, `live-source.available` |
| `bun run verify:m075 -- --live --allow-blocked --json` | 0 | blocked-json-captured | JSON remains `success=false`, `statusCode=m075_live_blocked`; exit zero is only for artifact capture |
| `bun test scripts/verify-m075.test.ts scripts/verify-m075-s01.test.ts scripts/verify-m075-s02.test.ts scripts/verify-m075-s03.test.ts scripts/verify-m075-s04.test.ts scripts/verify-m075-s05.test.ts scripts/verify-m075-s06.test.ts` | 0 | pass | 73 tests passed, 0 failed, 304 assertions |

## Local aggregate proof

Generated: `2026-05-20T18:21:27.516Z`

| Field | Value |
|---|---|
| Mode | `local` |
| Status code | `m075_ok` |
| Success | `true` |
| Failed check ids | none |
| Child count | 6 |
| Passed child count | 6 |
| Failed child count | 0 |
| Blocked child count | 0 |
| Package scripts checked | `verify:m075`, `verify:m075:s01`, `verify:m075:s02`, `verify:m075:s03`, `verify:m075:s04`, `verify:m075:s05`, `verify:m075:s06` |

### Local child verifier summary

| Slice | Command | Status code | Failed check ids | Checks | Issues |
|---|---|---|---|---:|---:|
| S01 | `verify:m075:s01` | `m075_s01_ok` | none | 9 | 0 |
| S02 | `verify:m075:s02` | `m075_s02_ok` | none | 5 | 0 |
| S03 | `verify:m075:s03` | `m075_s03_ok` | none | 12 | 0 |
| S04 | `verify:m075:s04` | `m075_s04_ok` | none | 11 | 0 |
| S05 | `verify:m075:s05` | `m075_s05_ok` | none | 9 | 0 |
| S06 | `verify:m075:s06` | `m075_s06_ok` | none | 10 | 0 |

### Local aggregate check ids

| Check id | Status | Meaning |
|---|---|---|
| `local.s01.pass` | pass | S01 production-log baseline verifier passed. |
| `local.s02.pass` | pass | S02 undefined-write verifier passed. |
| `local.s03.pass` | pass | S03 inline-publication verifier passed. |
| `local.s04.pass` | pass | S04 candidate-publication verifier passed. |
| `local.s05.pass` | pass | S05 review-timeout classification verifier passed. |
| `local.s06.pass` | pass | S06 addon-check classification verifier passed. |
| `package-wiring.present` | pass | Aggregate and slice package scripts are wired. |
| `redaction.safe` | pass | Aggregate output excludes raw logs, prompts, model/tool payloads, diffs, local paths, and secret-like values. |
| `local-contracts.pass` | pass | All S01-S06 local contracts passed. |

## Live production proof

Generated: `2026-05-20T18:21:38.350Z`

| Field | Value |
|---|---|
| Mode | `live` |
| Status code | `m075_live_blocked` |
| Success | `false` |
| Failed/blocked check ids | `health.source.blocked`, `live-log-source.blocked`, `live-redaction.safe`, `live-source.available` |
| Health base URL configured | `false` |
| `/healthz` status | unavailable |
| `/readiness` status | unavailable |
| Readiness state | unavailable |
| Readiness degraded | `false` |
| Live Log Analytics source availability | `blocked` |
| Workspaces queried | 0 |
| Windows present | none |
| Total rows inspected | 0 |
| Malformed rows | 0 |

### Live check ids

| Check id | Status | Operator interpretation |
|---|---|---|
| `health.source.blocked` | blocked | Production base URL was not configured, so health/readiness were not queried. |
| `live-log-source.blocked` | blocked | Log Analytics proof was skipped because production health source was blocked. |
| `live-source.available` | blocked | Live source proof does not count as R156 success. |
| `raw-regression.absent` | pass-with-blocked-source | Raw regression scan was not run because live proof is blocked; this is not production cleanup evidence. |
| `structured-reclassification.visible` | pass-with-blocked-source | Structured reclassification scan was not run because live proof is blocked; zero is acceptable only as blocked evidence. |
| `live-redaction.safe` | blocked | Live redaction proof is blocked because live evidence was not collected. |

### Live bounded class counts

These counts come from the blocked live report. They are retained only to show the bounded report shape; because the source was blocked, they must not be read as live production absence.

| Class | Count | Interpretation |
|---|---:|---|
| `knowledge-store.undefined-write` | 0 | Not queried because live source is blocked. |
| `candidate-publication.non-approved-missing-reason` | 0 | Not queried because live source is blocked. |
| `review.timeout-or-long-run` | 0 | Not queried because live source is blocked. |
| `addon-check.timeout` | 0 | Not queried because live source is blocked. |
| `review-timeout-classification.expected-bounded-outcome` | 0 | Not queried because live source is blocked. |
| `addon-check-classification.expected-bounded-outcome` | 0 | Not queried because live source is blocked. |
| `review-timeout-classification.hard-failure` | 0 | Not queried because live source is blocked. |
| `review-timeout-classification.long-run-threshold` | 0 | Not queried because live source is blocked. |
| `addon-check-classification.actionable-diagnostic` | 0 | Not queried because live source is blocked. |
| `addon-check-classification.malformed-evidence` | 0 | Not queried because live source is blocked. |
| `inline-publication.line-not-commentable` | 0 | Not queried because live source is blocked. |

## Critical slice verifier proof

Each critical slice verifier was run through package wiring with `--json` and returned exit code 0.

| Command | Status code | Failed check ids | Bounded observed counts |
|---|---|---|---|
| `bun run verify:m075:s01 -- --json` | `m075_s01_ok` | none | local fixture contract passed |
| `bun run verify:m075:s02 -- --json` | `m075_s02_ok` | none | local fixture contract passed |
| `bun run verify:m075:s03 -- --json` | `m075_s03_ok` | none | local fixture contract passed |
| `bun run verify:m075:s04 -- --json` | `m075_s04_ok` | none | local fixture contract passed |
| `bun run verify:m075:s05 -- --json` | `m075_s05_ok` | none | `scenarioCount=8`, `modeCount=8` |
| `bun run verify:m075:s06 -- --json` | `m075_s06_ok` | none | `scenarioCount=7`, `modeCount=7` |

## Negative-test proof

The verifier test suite passed with 73 tests and 304 assertions. The covered rejection/fail-closed areas include raw canaries, unsafe fixture paths, malformed live responses, bounded issue arrays/counts, redaction failures, blocked live source semantics, and package drift.

## Follow-up rule for milestone completion

Raw targeted issue classes must be zero for milestone completion; Azure platform noise may remain separated; structured expected-bounded outcomes are allowed; structured hard/actionable outcomes must remain visible for triage.

Do not mark R156 validated until `bun run verify:m075 -- --live --json` exits 0 with live source availability, health/readiness success, redaction success, and zero raw targeted issue classes.
