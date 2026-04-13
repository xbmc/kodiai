# S03: Truthful Bounded Reviews and Synchronize Continuity

**Goal:** Make synchronize-trigger intent and bounded strict-review behavior truthful end-to-end on the live PR review path without adding small-PR overhead or breaking the existing GitHub publication and operator-evidence surfaces.
**Demo:** Push new commits to an xbmc/kodiai PR and see synchronize-triggered reviews fire when configured; on high-risk strict reviews, the GitHub-visible outcome and Review Details clearly disclose any bounded or reduced-scope behavior instead of implying exhaustive coverage.

## Must-Haves

- Repo config, parser, and handler tests agree on `review.triggers.onSynchronize`, and legacy top-level intent no longer silently disables synchronize reruns.
- The checked-in xbmc/kodiai config actually enables synchronize-triggered reviews, and local verification fails loudly if future drift makes intent and effective state diverge.
- Large or timeout-bounded strict reviews disclose requested versus effective scope clearly on the GitHub-visible summary and Review Details surfaces, exactly once when needed.
- Small and unbounded reviews preserve the normal path: no new disclosure noise, no parallel evidence surface, and no hidden latency or cost tax beyond the existing S01/S02 timing capture.
- `verify:m048:s03` reuses the existing `reviewOutputKey` plus S01/S02 evidence contract and can validate both local preflight and live synchronize review-output keys.

## Threat Surface

- **Abuse**: Hidden config drift could make operators think synchronize reviews fire when runtime disables them, and missing bounded-review disclosure could make an explicit strict review look exhaustive when it is not.
- **Data exposure**: New warnings, disclosure helpers, and verifier output may carry `reviewOutputKey`, `deliveryId`, repo config, and risk-sorted file counts, but they must not expose prompt bodies, secrets, or workspace-internal paths beyond existing operator-visible identifiers.
- **Input trust**: `.kodiai.yml`, parsed trigger values, large-PR triage counts, generated summary bodies, and operator-supplied `reviewOutputKey` arguments are untrusted until normalized and cross-checked.

## Requirement Impact

- **Requirements touched**: `R049`, `R050`, `R051`, and `R052`; preserve `R034`, `R043`, and `R044` while bounded-review disclosure lands.
- **Re-verify**: `src/execution/config.test.ts`, `src/lib/review-boundedness.test.ts`, `src/lib/review-utils.test.ts`, `src/execution/review-prompt.test.ts`, `src/handlers/review.test.ts`, `scripts/verify-m048-s03.test.ts`, plus post-deploy `bun run verify:m048:s03 -- --review-output-key <synchronize-key> --json`.
- **Decisions revisited**: `D102`, `D103`, `D104`, `D105`, `D106`, and `D109` because S03 must reuse the existing evidence contract while changing product-facing bounded-review semantics.

## Proof Level

- This slice proves: contract-level proof that synchronize intent maps to effective runtime behavior, plus operator-visible bounded-review disclosure on the real GitHub review path; final milestone proof still requires a fresh deployed synchronize-triggered review.

## Integration Closure

- Upstream surfaces consumed: `.kodiai.yml`, `src/execution/config.ts`, `src/handlers/review.ts`, `src/lib/review-utils.ts`, `src/execution/review-prompt.ts`, `scripts/verify-m048-s01.ts`, `scripts/verify-m048-s02.ts`, and the shared `reviewOutputKey` parser/evidence contract from S01/S02.
- New wiring introduced in this slice: synchronize-intent drift detection, one bounded-review disclosure contract reused across prompt/details/summary publication, and `verify:m048:s03` local/live verification.
- What remains before the milestone is truly usable end-to-end: deploy S03, push a new commit to an `xbmc/kodiai` PR, capture the resulting synchronize `reviewOutputKey`, and rerun `bun run verify:m048:s03 -- --review-output-key <key> --json`.

## Verification

- `bun test ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s03.test.ts`
- `bun run tsc --noEmit`
- `bun run verify:m048:s03 -- --json`
- `bun run verify:m048:s03 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`

## Tasks

- [x] **T01: Restore synchronize-trigger continuity from repo config through handler gating** `est:90m`
  **Slice:** S03 — Truthful Bounded Reviews and Synchronize Continuity
**Milestone:** M048

## Description

The repo currently intends synchronize reruns, but `.kodiai.yml` uses legacy `review.onSynchronize` while `src/execution/config.ts` only honors `review.triggers.onSynchronize`. This task should close that continuity gap at the config/parser boundary, make the handler's synchronize behavior provable in tests, and update the checked-in repo/docs so the live xbmc loop can actually fire on new commits.

## Steps

1. Add failing coverage in `src/execution/config.test.ts` for the current legacy top-level `review.onSynchronize` shape, the correct nested `review.triggers.onSynchronize` shape, and any warning/helper output that distinguishes intent from effective runtime behavior.
2. Update `src/execution/config.ts` to detect the legacy key instead of silently stripping it, surface a fail-loud warning/helper signal, and keep the normal nested trigger path fast/default for correctly shaped configs.
3. Fix the checked-in `.kodiai.yml` and `docs/configuration.md` examples to use `review.triggers.onSynchronize`, then add or extend `src/handlers/review.test.ts` so `pull_request.synchronize` executes only when the effective trigger is enabled.
4. Re-run the focused tests and `tsc` so the repo config actually enables synchronize reruns and the false-green drift cannot regress unnoticed.

## Must-Haves

- [ ] Legacy `review.onSynchronize` no longer false-greens as “configured but disabled with no warning.”
- [ ] The checked-in repo config uses the same nested trigger shape the parser actually reads.
- [ ] Handler coverage proves `pull_request.synchronize` is wired to the effective trigger state, not the raw YAML shape.
  - Files: `.kodiai.yml`, `src/execution/config.ts`, `src/execution/config.test.ts`, `src/handlers/review.test.ts`, `docs/configuration.md`
  - Verify: - `bun test ./src/execution/config.test.ts ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`

- [ ] **T02: Thread one bounded-review contract through prompt, Review Details, and summary publication** `est:2h`
  **Slice:** S03 — Truthful Bounded Reviews and Synchronize Continuity
**Milestone:** M048

## Description

Strict reviews are already bounded on large PRs, and timeout pressure can further reduce scope, but today's GitHub-visible surfaces do not explain that truth clearly. This task should define one small bounded-review contract, reuse it across the handler, prompt, and Review Details paths, and preserve the small-PR fast path so S03 improves truthfulness without adding normal-case noise or latency.

## Steps

1. Add failing contract tests in `src/lib/review-boundedness.test.ts`, `src/lib/review-utils.test.ts`, `src/execution/review-prompt.test.ts`, and `src/handlers/review.test.ts` for large-PR strict reviews, timeout-driven reductions, explicit-profile skip paths, and small PRs that should remain silent.
2. Extract a focused bounded-review helper in `src/lib/review-boundedness.ts` that captures requested versus effective profile, large-PR triage coverage, timeout reduction or skip reason, and the exact disclosure sentence required on GitHub-visible surfaces.
3. Thread that contract through `src/handlers/review.ts`, `src/execution/review-prompt.ts`, and `src/lib/review-utils.ts` so Review Details shows requested/effective behavior, the prompt asks for one exact `## What Changed` disclosure when needed, and summary publication backfills the sentence exactly once if the model omits it.
4. Update `docs/configuration.md` to clarify that large-PR triage already bounds file coverage and that any `timeout.autoReduceScope` or explicit strict bounded behavior is disclosed instead of implying exhaustive review.
5. Re-run focused tests and `tsc`, verifying that bounded cases become explicit while the small-PR path stays clean and fast.

## Must-Haves

- [ ] One bounded-review contract powers prompt, Review Details, summary injection, and later verifier checks.
- [ ] Large or timeout-bounded explicit strict reviews disclose requested versus actual scope clearly, exactly once, on GitHub-visible output.
- [ ] Small PRs and unbounded reviews do not gain extra disclosure noise or hidden new normal-path work.
  - Files: `src/lib/review-boundedness.ts`, `src/lib/review-boundedness.test.ts`, `src/handlers/review.ts`, `src/lib/review-utils.ts`, `src/lib/review-utils.test.ts`, `src/execution/review-prompt.ts`, `src/execution/review-prompt.test.ts`, `src/handlers/review.test.ts`, `docs/configuration.md`
  - Verify: - `bun test ./src/lib/review-boundedness.test.ts ./src/lib/review-utils.test.ts ./src/execution/review-prompt.test.ts ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`

- [ ] **T03: Ship verify:m048:s03 preflight and live synchronize proof without inventing a new evidence path** `est:90m`
  **Slice:** S03 — Truthful Bounded Reviews and Synchronize Continuity
**Milestone:** M048

## Description

S03 needs an operator command that can fail loudly before deploy when synchronize intent is misconfigured and can prove the live path after deploy using the same evidence seams S01 and S02 already established. This task should add a dedicated verifier for local preflight plus optional live synchronize review keys, while reusing existing `reviewOutputKey`, Review Details, and Azure-backed evidence surfaces instead of creating a parallel report.

## Steps

1. Add failing tests in `scripts/verify-m048-s03.test.ts` for config preflight pass/fail, bounded-disclosure fixture checks, empty optional live input, and rejection of non-synchronize `reviewOutputKey` values.
2. Implement `scripts/verify-m048-s03.ts` so it loads repo config and fails when synchronize intent is mis-shaped or effectively disabled, evaluates bounded-review disclosure fixtures via the shared helper from T02, and optionally accepts `--review-output-key` while requiring `action=synchronize`.
3. Reuse the existing S01/S02 verifier seams instead of inventing a new evidence store: embed the local preflight verdict plus any phase-evidence or continuity data needed for operator output, and wire `verify:m048:s03` into `package.json`.
4. Re-run focused tests, `tsc`, and the local verifier command so the slice has deterministic proof even before the post-deploy synchronize run.

## Must-Haves

- [ ] `verify:m048:s03` fails loudly when repo intent says synchronize but effective config does not enable it.
- [ ] Local or fixture output verifies the bounded-review disclosure contract without needing live GitHub or Azure data.
- [ ] Live mode only accepts `reviewOutputKey` values whose parsed action is `synchronize` and reuses the S01/S02 evidence surface rather than parallel reporting.
  - Files: `scripts/verify-m048-s03.ts`, `scripts/verify-m048-s03.test.ts`, `scripts/verify-m048-s01.ts`, `scripts/verify-m048-s02.ts`, `src/execution/config.ts`, `src/lib/review-boundedness.ts`, `src/handlers/review-idempotency.ts`, `package.json`
  - Verify: - `bun test ./scripts/verify-m048-s03.test.ts ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts`
- `bun run tsc --noEmit`
- `bun run verify:m048:s03 -- --json`

## Files Likely Touched

- .kodiai.yml
- src/execution/config.ts
- src/execution/config.test.ts
- src/handlers/review.test.ts
- docs/configuration.md
- src/lib/review-boundedness.ts
- src/lib/review-boundedness.test.ts
- src/handlers/review.ts
- src/lib/review-utils.ts
- src/lib/review-utils.test.ts
- src/execution/review-prompt.ts
- src/execution/review-prompt.test.ts
- scripts/verify-m048-s03.ts
- scripts/verify-m048-s03.test.ts
- scripts/verify-m048-s01.ts
- scripts/verify-m048-s02.ts
- src/handlers/review-idempotency.ts
- package.json
