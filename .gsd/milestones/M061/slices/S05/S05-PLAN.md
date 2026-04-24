# S05: Integrated Token-Reduction Proof and Regression Gate

**Goal:** Compose the S02-S04 telemetry/reporting seams into one milestone-level proof surface and one pinned regression gate so operators can rerun canonical evidence for lower token spend on representative mention/review paths without regressing grounding, publication behavior, or fail-open semantics.
**Demo:** Kodiai has a repeatable proof surface showing lower token spend on representative mention/review paths while preserving grounding, publication behavior, and fail-open semantics.

## Must-Haves

- ## Demo
- After this slice, Kodiai has a repeatable proof surface showing lower token spend on representative mention/review paths while preserving grounding, publication behavior, and fail-open semantics.
- ## Must-Haves
- A new canonical milestone verifier proves the integrated M061 token-reduction story by composing the existing S01-S04 proof seams instead of inventing a second telemetry path.
- The milestone verifier checks live-telemetry availability, baseline coverage, mention-path reduction evidence, review-path section compaction/truncation evidence, and truthful reuse hit/miss/degraded reporting.
- The integrated proof remains fail-open: when Postgres telemetry is missing or unavailable it reports that state explicitly and still leaves local regression verification usable.
- A separate pinned regression gate runs the exact mention/review/retrieval/reporting suites that protect normal behavior and publication semantics while token-efficiency work evolves.
- `package.json` exposes the full operator surface for `verify:m061:s03`, `verify:m061:s04`, `verify:m061:s05`, and the new M061 regression gate alias.
- ## Threat Surface
- **Abuse**: Incorrect proof logic could falsely claim token reduction or silently treat missing telemetry as success, causing operators to trust a broken optimization path.
- **Data exposure**: The proof surface must stay text-free and operate only on existing aggregate telemetry/reuse rows; it must not introduce raw prompt capture or expose repository content.
- **Input trust**: CLI args (`--repo`, `--since`, `--json`) and live Postgres results are untrusted inputs; the verifier must normalize filters, bound DB access, and degrade explicitly on malformed/unavailable telemetry.
- ## Requirement Impact
- **Requirements touched**: R068, R069.
- **Re-verify**: canonical usage-report/verifier surfaces, mention/review publication behavior regression suites, retrieval reuse regression suites, and fail-open database-unavailable behavior.
- **Decisions revisited**: D175, D176, D177, D178 stay in force; S05 must compose their canonical surfaces rather than adding a parallel proof path.
- ## Verification
- `bun test scripts/usage-report.test.ts scripts/verify-m061-s01.test.ts scripts/verify-m061-s02.test.ts scripts/verify-m061-s03.test.ts scripts/verify-m061-s04.test.ts scripts/verify-m061-s05.test.ts scripts/phase-m061-token-regression-gate.test.ts`
- `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts src/execution/review-prompt.test.ts src/handlers/review.test.ts src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts`
- `bun scripts/verify-m061-s05.ts --json`
- `bun scripts/phase-m061-token-regression-gate.ts`
- `bun run lint`

## Proof Level

- This slice proves: - This slice proves: final-assembly.
- Real runtime required: yes — the integrated verifier must consume the canonical Postgres-backed usage-report seam when available and fail open when it is not.
- Human/UAT required: no.

## Integration Closure

- Upstream surfaces consumed: `scripts/usage-report.ts`, `scripts/verify-m061-s01.ts`, `scripts/verify-m061-s02.ts`, `scripts/verify-m061-s03.ts`, `scripts/verify-m061-s04.ts`, `package.json`.
- New wiring introduced in this slice: a milestone-level `scripts/verify-m061-s05.ts` entrypoint, a separate `scripts/phase-m061-token-regression-gate.ts` runner, and package-script aliases exposing the complete M061 proof surface.
- What remains before the milestone is truly usable end-to-end: nothing inside M061 token-proof assembly beyond obtaining representative live telemetry in environments where Postgres is reachable.

## Verification

- Runtime signals: reuse hit/miss/degraded evidence, prompt-section attribution/truncation rows, and delivery/token totals remain the only canonical proof inputs.
- Inspection surfaces: `bun scripts/usage-report.ts`, `bun scripts/verify-m061-s03.ts`, `bun scripts/verify-m061-s04.ts`, new `bun scripts/verify-m061-s05.ts`, and the new regression gate CLI.
- Failure visibility: the integrated verifier must report `databaseAccess`/preflight detail explicitly, and the regression gate must emit stable check IDs for the pinned suite set.
- Redaction constraints: no prompt text, repository secrets, or raw GitHub payloads may be emitted; only aggregate/tokenized telemetry and test status are allowed.

## Tasks

- [x] **T01: Build the integrated M061 token-reduction verifier** `est:90m`
  ## Description
Create the milestone-level proof entrypoint that turns the existing S01-S04 proof seams into one operator-facing verdict. This task closes the main S05 gap: there is no current `verify:m061:s05` surface that proves baseline visibility, mention-path reduction, review-path compaction/truncation, truthful reuse evidence, and an integrated lower-token story on representative mention/review deliveries.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/usage-report.ts` query helpers | Return a preflight-only fail-open report with explicit database access detail | Use the existing bounded timeout path and surface `databaseAccess: unavailable` instead of hanging | Treat missing/partial rows as failed checks with explicit check details, not silent success |
| `scripts/verify-m061-s01.ts` / `scripts/verify-m061-s03.ts` / `scripts/verify-m061-s04.ts` evaluators | Bubble the failure into named S05 checks and keep the report renderable | Stop composition and emit explicit preflight/check failure detail | Mark the affected integrated check failed with the missing evidence spelled out |
| Live Postgres telemetry | Fail open and preserve local verifier/test execution | Fail open via bounded timeout | Report malformed evidence as a failed proof, not a pass |

## Load Profile
- **Shared resources**: Postgres connections through the canonical usage-report query path.
- **Per-operation cost**: one bounded usage-report query plus in-process evaluation over delivery/prompt/reuse aggregates.
- **10x breakpoint**: slow/unavailable telemetry becomes the first failure mode, so the script must keep the existing timeout + explicit shutdown discipline.

## Negative Tests
- **Malformed inputs**: invalid `--since`, empty result sets, partial prompt/reuse rows, and delivery sets with no representative mention/review mix.
- **Error paths**: missing DB URL, unreachable Postgres, and composed sub-proof failures.
- **Boundary conditions**: telemetry that contains only mention or only review rows, telemetry with named sections but no truncation, and telemetry with reuse rows but no retrieval hits.

## Steps
1. Add `scripts/verify-m061-s05.ts` that parses the same CLI filters as prior slice verifiers and queries telemetry only through `queryUsageReportWithTimeout()`.
2. Compose existing proof evaluators where practical, then add S05-only integrated checks that compare representative `mention.response` and `review.full` delivery rows/section counts to prove the lower-token story without hardcoded historical thresholds.
3. Add `scripts/verify-m061-s05.test.ts` covering pass, fail, and fail-open cases, including explicit checks for token-signal reasoning and composed evidence reporting.

## Must-Haves
- [ ] `verify-m061-s05` stays on the canonical usage-report telemetry path and does not add a second data source.
- [ ] The report distinguishes preflight availability from proof failure and never treats unavailable telemetry as PASS.
- [ ] Integrated checks name the exact missing evidence so operators can tell whether the gap is baseline, mention reduction, review compaction, reuse truthfulness, or token-signal composition.
  - Files: `scripts/verify-m061-s05.ts`, `scripts/verify-m061-s05.test.ts`, `scripts/usage-report.ts`, `scripts/verify-m061-s01.ts`, `scripts/verify-m061-s02.ts`, `scripts/verify-m061-s03.ts`, `scripts/verify-m061-s04.ts`
  - Verify: bun test scripts/usage-report.test.ts scripts/verify-m061-s01.test.ts scripts/verify-m061-s02.test.ts scripts/verify-m061-s03.test.ts scripts/verify-m061-s04.test.ts scripts/verify-m061-s05.test.ts

- [ ] **T02: Pin the M061 regression gate for mention, review, retrieval, and reporting behavior** `est:75m`
  ## Description
Add a separate regression gate CLI that runs the exact suite set protecting small/normal behavior while token-efficiency proof evolves. Keeping this separate from the live-telemetry verifier ensures DB-unavailable environments still have a meaningful blocking gate for R069.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `bun test` suite execution | Mark the named gate check failed with captured status/stdout/stderr | Surface timeout/non-zero status in the check detail and keep evaluating remaining pinned suites | Treat unexpected command results as failures with explicit command output |
| Test file inventory | Fail the gate test expectations if pinned paths drift or disappear | N/A | Treat missing files/commands as blocking regression failures |

## Load Profile
- **Shared resources**: local test runner process execution and any shared fixture/runtime state those tests use.
- **Per-operation cost**: one spawned `bun test` process per pinned suite group.
- **10x breakpoint**: total CI/runtime duration rises with suite count, so the gate should group tests intentionally and keep output concise.

## Negative Tests
- **Malformed inputs**: help mode, missing executable in a suite definition, and empty command definitions.
- **Error paths**: non-zero suite status and thrown spawn errors.
- **Boundary conditions**: one failing suite among many, all suites passing, and renderer output listing stable failing check IDs.

## Steps
1. Add `scripts/phase-m061-token-regression-gate.ts` following the stable Phase 80 gate pattern with M061-specific pinned suite IDs and commands.
2. Pin the mention, review, retrieval, and reporting/verifier suite groups called out in S05 research so the gate protects publication semantics and canonical proof surfaces together.
3. Add `scripts/phase-m061-token-regression-gate.test.ts` for pass/fail/help behavior and stable check rendering.

## Must-Haves
- [ ] The regression gate is separate from live telemetry proof and still works when Postgres is unavailable.
- [ ] Stable check IDs make it obvious which suite group regressed.
- [ ] The pinned suites include mention, review, retrieval, usage-report, and M061 verifier coverage rather than only unit tests for one subsystem.
  - Files: `scripts/phase80-slack-regression-gate.ts`, `scripts/phase-m061-token-regression-gate.ts`, `scripts/phase-m061-token-regression-gate.test.ts`, `src/execution/mention-context.test.ts`, `src/execution/mention-prompt.test.ts`, `src/handlers/mention.test.ts`, `src/execution/review-prompt.test.ts`, `src/handlers/review.test.ts`, `src/knowledge/retrieval.test.ts`, `src/knowledge/retrieval.e2e.test.ts`, `src/knowledge/multi-query-retrieval.test.ts`, `scripts/usage-report.test.ts`, `scripts/verify-m061-s01.test.ts`, `scripts/verify-m061-s02.test.ts`, `scripts/verify-m061-s03.test.ts`, `scripts/verify-m061-s04.test.ts`
  - Verify: bun test scripts/phase-m061-token-regression-gate.test.ts && bun scripts/phase-m061-token-regression-gate.ts

- [ ] **T03: Expose the complete M061 operator proof surface and prove it end-to-end** `est:45m`
  ## Description
Wire the new and existing proof surfaces into `package.json`, then close the slice with the exact smoke/regression commands the roadmap promises. This task exists so operators can discover and rerun S03/S04/S05 proof entrypoints and the final regression gate without knowing script filenames.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `package.json` script wiring | Fail fast in tests/CLI execution when an alias points at the wrong file | Surface the hanging command or wrong script target during smoke verification | Treat missing aliases as a regression in operator surface coverage |
| New verifier/gate CLIs | Keep the task blocked until smoke commands either pass or fail open with explicit preflight state | Use the verifier's bounded timeout behavior and do not accept silent hangs | Treat malformed JSON/text output as failed smoke verification |

## Negative Tests
- **Malformed inputs**: missing script aliases, wrong script target names, and JSON smoke output that omits preflight/check IDs.
- **Error paths**: verifier fail-open path when DB is unavailable and regression gate non-zero exit if any pinned suite regresses.
- **Boundary conditions**: smoke verification in a no-DB environment and lint after all script wiring changes.

## Steps
1. Add package aliases for `verify:m061:s03`, `verify:m061:s04`, `verify:m061:s05`, and the M061 regression gate if any are missing.
2. Run the canonical script/unit suites plus `bun scripts/verify-m061-s05.ts --json`, `bun scripts/phase-m061-token-regression-gate.ts`, and `bun run lint`.
3. Tighten any remaining test expectations or script help text so the public operator surface matches the roadmap/research contract exactly.

## Must-Haves
- [ ] `package.json` exposes every M061 proof/regression entrypoint promised by S05.
- [ ] End-to-end verification covers both live-proof/fail-open CLI behavior and the pinned regression gate.
- [ ] The final slice verification commands are the same ones documented at slice level, so completion claims map directly to executable evidence.
  - Files: `package.json`, `scripts/verify-m061-s03.ts`, `scripts/verify-m061-s04.ts`, `scripts/verify-m061-s05.ts`, `scripts/phase-m061-token-regression-gate.ts`
  - Verify: bun test scripts/usage-report.test.ts scripts/verify-m061-s01.test.ts scripts/verify-m061-s02.test.ts scripts/verify-m061-s03.test.ts scripts/verify-m061-s04.test.ts scripts/verify-m061-s05.test.ts scripts/phase-m061-token-regression-gate.test.ts && bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts src/execution/review-prompt.test.ts src/handlers/review.test.ts src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts && bun scripts/verify-m061-s05.ts --json && bun scripts/phase-m061-token-regression-gate.ts && bun run lint

## Files Likely Touched

- scripts/verify-m061-s05.ts
- scripts/verify-m061-s05.test.ts
- scripts/usage-report.ts
- scripts/verify-m061-s01.ts
- scripts/verify-m061-s02.ts
- scripts/verify-m061-s03.ts
- scripts/verify-m061-s04.ts
- scripts/phase80-slack-regression-gate.ts
- scripts/phase-m061-token-regression-gate.ts
- scripts/phase-m061-token-regression-gate.test.ts
- src/execution/mention-context.test.ts
- src/execution/mention-prompt.test.ts
- src/handlers/mention.test.ts
- src/execution/review-prompt.test.ts
- src/handlers/review.test.ts
- src/knowledge/retrieval.test.ts
- src/knowledge/retrieval.e2e.test.ts
- src/knowledge/multi-query-retrieval.test.ts
- scripts/usage-report.test.ts
- scripts/verify-m061-s01.test.ts
- scripts/verify-m061-s02.test.ts
- scripts/verify-m061-s03.test.ts
- scripts/verify-m061-s04.test.ts
- package.json
