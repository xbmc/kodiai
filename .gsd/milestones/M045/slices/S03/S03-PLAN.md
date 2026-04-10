# S03: Operator Verifier for Cross-Surface Contract Drift

**Goal:** Ship one operator-facing verifier command that proves the contributor-experience contract stays coherent across GitHub review prompt/details, retrieval hint shaping, Slack profile and opt controls, and identity-link opt-out messaging without changing runtime behavior.
**Demo:** An operator runs one M045 verifier command and gets named pass/fail results for review prompt/details behavior, Slack profile output, retrieval shaping or exclusion, and opt-out truthfulness, with both human-readable and JSON output.

## Must-Haves

- **Demo:** An operator runs `bun run verify:m045:s03` or `bun run verify:m045:s03 -- --json` and gets named pass/fail results for GitHub review prompt/details behavior, retrieval shaping or omission, Slack `/kodiai profile` / opt-in / opt-out / help output, and identity-link opt-out truthfulness.
- ## Must-Haves
- Compose the existing S01 GitHub review proof harness into `scripts/verify-m045-s03.ts` so the operator command preserves S01 named check results instead of collapsing them to one boolean.
- Add independent retrieval drift checks that assert contract-approved inclusion and omission behavior against both `buildRetrievalVariants()` and `buildRetrievalQuery()` for `profile-backed`, `coarse-fallback`, and generic contract states.
- Add handler-driven Slack checks that verify linked-profile, opted-out, malformed-tier, `profile opt-out`, `profile opt-in`, and unknown-command help output without leaking raw tier/score semantics.
- Add identity-link messaging checks that stub Slack fetches, reset process-local suggestion state, assert the DM mentions linked-profile guidance plus `/kodiai profile opt-out`, and preserve fail-open warning behavior.
- Keep the verifier script local and deterministic: no live Slack or GitHub calls, no new runtime behavior changes, stable human-readable and JSON output, and non-zero exit status on any failed check.
- ## Threat Surface
- **Abuse**: a false-green verifier could hide contract drift if it derives expected text from the same code path under test, skips generic-state coverage, or drops embedded S01 results; the plan must keep required/banned phrases local to the S03 verifier and preserve named check output.
- **Data exposure**: human and JSON verifier output must stay synthetic and local; it should not echo real Slack tokens, raw profile IDs, or secret-bearing request data while still surfacing enough phrase-level diagnostics to debug drift.
- **Input trust**: stored contributor tiers, contract state projections, slash-command text, mocked Slack API payloads, and identity-match results are all untrusted until normalized by explicit verifier fixtures and assertions.
- ## Requirement Impact
- **Requirements touched**: R046.
- **Re-verify**: `scripts/verify-m045-s01.ts` composition, retrieval query shaping/omission, Slack `/kodiai profile` / `profile opt-in` / `profile opt-out` / help text, identity-link DM wording, verifier JSON schema, and exit-code behavior.
- **Decisions revisited**: D066, D068, D069.
- ## Verification
- `bun test ./scripts/verify-m045-s03.test.ts`
- `bun run verify:m045:s03`
- `bun run verify:m045:s03 -- --json`
- `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts ./scripts/verify-m045-s01.test.ts ./scripts/verify-m045-s03.test.ts`
- `bun run tsc --noEmit`

## Proof Level

- This slice proves: - This slice proves: final-assembly proof of the M045 contributor-experience contract at the operator verifier boundary.
- Real runtime required: no.
- Human/UAT required: no.

## Integration Closure

- Upstream surfaces consumed: `scripts/verify-m045-s01.ts`, `src/contributor/experience-contract.ts`, `src/knowledge/multi-query-retrieval.ts`, `src/knowledge/retrieval-query.ts`, `src/slack/slash-command-handler.ts`, and `src/handlers/identity-suggest.ts`.
- New wiring introduced in this slice: `scripts/verify-m045-s03.ts` composes the S01 GitHub report and adds independent retrieval, Slack, and identity-copy proof checks behind one package entrypoint.
- What remains before the milestone is truly usable end-to-end: nothing in product behavior; only milestone validation/completion remains once this verifier and its regression suite pass.

## Verification

- Runtime signals: verifier `check_ids`, per-check `status_code`, nested GitHub scenario results, and phrase-level `missingPhrases` / `unexpectedPhrases` diagnostics become the operator-facing drift indicators.
- Inspection surfaces: `bun run verify:m045:s03`, `bun run verify:m045:s03 -- --json`, and `scripts/verify-m045-s03.test.ts`.
- Failure visibility: failing output names the surface, scenario, and drift reason; stderr summarizes failing check IDs for fast triage.
- Redaction constraints: keep fixtures synthetic and avoid printing real Slack tokens, raw profile IDs, or non-essential user identifiers.

## Tasks

- [x] **T01: Compose the S03 verifier around S01 and retrieval drift checks** `est:2h`
  This task establishes the operator-facing proof harness in `scripts/verify-m045-s03.ts` without changing runtime behavior. Reuse `evaluateM045S01()` and its named check/report output instead of recreating GitHub prompt/details expectations, then add independent retrieval drift fixtures so the first version of S03 already proves the GitHub review surface plus retrieval shaping/omission from one command. Keep required and banned retrieval phrases local to the S03 verifier; do not generate expected strings by calling the same helper under test.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Embedded S01 report from `scripts/verify-m045-s01.ts` | Fail the S03 verifier with a named composition failure instead of silently dropping GitHub review results. | N/A — local in-process evaluation only. | Treat missing nested `check_ids`, `checks`, or scenario data as verifier drift and fail fast. |
| Retrieval builders in `src/knowledge/multi-query-retrieval.ts` and `src/knowledge/retrieval-query.ts` | Record named retrieval-check failures; do not patch runtime behavior from inside the verifier. | N/A — pure string construction. | Treat malformed or empty query text as drift and surface missing/banned phrase diagnostics. |
| Contract fixtures from `src/contributor/experience-contract.ts` | Default expectations to generic/no-hint behavior rather than inventing fallback tiers. | N/A — local fixture creation. | Add explicit negative fixtures for unsupported state/tier combinations so malformed inputs fail predictably. |

## Load Profile

- **Shared resources**: fixed in-process report assembly plus two retrieval-string builders; no live network or persistent state.
- **Per-operation cost**: one `evaluateM045S01()` call plus a small deterministic retrieval fixture matrix that exercises both builders.
- **10x breakpoint**: report drift or fixture sprawl would hurt readability first, so keep the matrix fixed, named, and bounded.

## Negative Tests

- **Malformed inputs**: unsupported contract state/tier combinations, missing embedded S01 fields, and blank query text all fail with named diagnostics.
- **Error paths**: retrieval checks still render a complete report when one surface fails; the verifier must not stop after the first bad fixture.
- **Boundary conditions**: `profile-backed` and `coarse-fallback` emit only approved hint phrases, while `generic-opt-out`, `generic-unknown`, and `generic-degraded` emit no `author:` / `Author:` fragment and no raw tier vocabulary.

## Steps

1. Define S03 report types, check IDs, and fixture helpers in `scripts/verify-m045-s03.ts`, importing `evaluateM045S01()` so the operator report preserves nested GitHub review checks and scenario detail.
2. Build retrieval fixtures from `projectContributorExperienceContract()` and assert both `buildRetrievalVariants()` and `buildRetrievalQuery()` require approved hint wording for adapted states and ban contributor hints for generic states.
3. Add human-readable rendering, `--json` handling, exit-code behavior, and a `verify:m045:s03` package script while keeping the report deterministic and script-local.
4. Write `scripts/verify-m045-s03.test.ts` cases that pin the happy-path report shape plus a malformed retrieval fixture failure with named diagnostics.

## Must-Haves

- [ ] The S03 report embeds the full S01 result set and preserves S01 named check IDs/status codes.
- [ ] Retrieval drift coverage exercises both the live multi-query builder and the legacy single-query helper against contract-approved inclusion/omission rules.
- [ ] `bun run verify:m045:s03` and `bun run verify:m045:s03 -- --json` execute through `package.json` and fail non-zero when any retrieval or embedded GitHub check fails.
  - Files: `scripts/verify-m045-s03.ts`, `scripts/verify-m045-s03.test.ts`, `package.json`
  - Verify: bun test ./scripts/verify-m045-s03.test.ts && bun run verify:m045:s03 -- --json

- [x] **T02: Add Slack and identity-link truthfulness checks to finalize the operator proof surface** `est:2h`
  This task finishes the operator verifier by proving the lesser-used downstream surfaces that can still drift after S01/S02: Slack `/kodiai profile` / opt controls / help text and identity-link DM wording. Drive the checks through the real exported seams (`handleKodiaiCommand()` and `suggestIdentityLink()`), but keep the expectations independent inside `scripts/verify-m045-s03.ts` so the verifier can actually catch copy drift. Reset `identity-suggest` process state between scenarios and stub `globalThis.fetch` deterministically; do not introduce live Slack calls.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `handleKodiaiCommand()` Slack fixtures | Fail the named Slack surface check and keep the rest of the report running. | N/A — local in-memory store only. | Treat malformed stored tier data as the generic fallback scenario and assert neutral copy instead of raw-tier leakage. |
| `suggestIdentityLink()` fetch stubs and reset seam | Restore `globalThis.fetch`, reset cached suggestion state, and fail the named identity check instead of leaking state across fixtures. | Simulate timeout/error as part of the fail-open warning fixture; do not block the verifier. | Treat malformed Slack API payloads as the fail-open path and assert warning visibility when appropriate. |
| S03 report renderer / exit handling | Keep human and JSON output in sync and return a non-zero exit code on any failed Slack or identity check. | N/A — local rendering only. | Surface missing sections or absent check IDs as verifier failures instead of producing partial success output. |

## Load Profile

- **Shared resources**: process-local identity-suggestion cache, mocked Slack fetch call log, and one combined verifier report.
- **Per-operation cost**: a handful of in-memory slash-command calls plus deterministic stubbed Slack HTTP sequences for DM cases.
- **10x breakpoint**: stale cached suggestion state or noisy report output would fail first, so reset module state per fixture and keep the surface matrix small and explicit.

## Negative Tests

- **Malformed inputs**: malformed stored tier data, unknown slash subcommands, and empty expertise arrays still yield contract-first generic output.
- **Error paths**: missing linked profile, existing linked profile, high-confidence match, and Slack API failure all stay deterministic and non-blocking.
- **Boundary conditions**: opted-out Slack output hides expertise, help text advertises both opt controls, the DM body includes `/kodiai profile opt-out`, and the verifier bans `personalized code reviews` wording.

## Steps

1. Add in-memory `ContributorProfileStore` fixture helpers and Slack surface checks in `scripts/verify-m045-s03.ts` for linked-profile, opted-out, malformed-tier, `profile opt-out`, `profile opt-in`, and unknown-command help output.
2. Add identity-link fixture runners that stub `globalThis.fetch`, call `resetIdentitySuggestionStateForTests()`, capture posted DM text, and assert both truthful high-confidence-match wording and fail-open warning behavior.
3. Extend the S03 report types, check IDs, renderer, and JSON output so Slack and identity results sit alongside embedded GitHub and retrieval checks with one overall verdict.
4. Expand `scripts/verify-m045-s03.test.ts` to cover Slack copy drift, DM wording drift, JSON serialization, and non-zero exit-code behavior, then finish with the broader regression suite.

## Must-Haves

- [ ] Slack verification uses real handler output for `/kodiai profile`, `profile opt-out`, `profile opt-in`, and unknown-command help rather than copied constants.
- [ ] Identity-link verification uses the exported reset seam plus stubbed fetches to prove truthful DM wording and fail-open warning behavior without live Slack traffic.
- [ ] The final S03 report gives named pass/fail results for GitHub review, retrieval, Slack, and identity surfaces in both human-readable and JSON modes.
  - Files: `scripts/verify-m045-s03.ts`, `scripts/verify-m045-s03.test.ts`
  - Verify: bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts ./scripts/verify-m045-s01.test.ts ./scripts/verify-m045-s03.test.ts && bun run verify:m045:s03 && bun run verify:m045:s03 -- --json && bun run tsc --noEmit

## Files Likely Touched

- scripts/verify-m045-s03.ts
- scripts/verify-m045-s03.test.ts
- package.json
