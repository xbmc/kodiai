---
estimated_steps: 24
estimated_files: 2
skills_used: []
---

# T02: Add Slack and identity-link truthfulness checks to finalize the operator proof surface

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

## Inputs

- ``scripts/verify-m045-s03.ts` — task-local verifier scaffold from T01 that already embeds GitHub and retrieval checks.`
- ``scripts/verify-m045-s03.test.ts` — initial regression harness to extend with Slack and identity coverage.`
- ``src/slack/slash-command-handler.ts` — real Slack command seam for profile cards, opt controls, and help text.`
- ``src/slack/slash-command-handler.test.ts` — exact-copy expectations that define the shipped Slack truth surface.`
- ``src/handlers/identity-suggest.ts` — real DM seam with exported reset hook and fail-open logging.`
- ``src/handlers/identity-suggest.test.ts` — exact-copy and fail-open expectations to mirror in the operator verifier.`
- ``scripts/verify-m045-s01.ts` — embedded GitHub review report that must remain intact while Slack and identity checks are added.`

## Expected Output

- ``scripts/verify-m045-s03.ts` — finalized operator verifier covering GitHub review, retrieval, Slack profile/opt controls, and identity-link truthfulness.`
- ``scripts/verify-m045-s03.test.ts` — final regression harness that pins human output, JSON shape, failure diagnostics, and exit-code behavior for all cross-surface checks.`

## Verification

bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts ./scripts/verify-m045-s01.test.ts ./scripts/verify-m045-s03.test.ts && bun run verify:m045:s03 && bun run verify:m045:s03 -- --json && bun run tsc --noEmit

## Observability Impact

- Signals added/changed: Slack and identity surface checks add named `status_code` values, DM/warning detail, and final verdict output to the operator report.
- How a future agent inspects this: run the verifier in human or JSON mode and inspect the Slack/identity sections plus stderr failure summary.
- Failure state exposed: contradictory opt-out copy, missing help text, leaked expertise, stale DM wording, or swallowed fail-open warnings show up as explicit named failures.
