# M045 S03 Research — Operator Verifier for Cross-Surface Contract Drift

## Requirement focus
- **R046** — This slice owns the operator-proof surface for the contributor-experience contract after S01/S02. The verifier must prove one coherent contract across:
  - GitHub review prompt + Review Details
  - retrieval hint shaping or omission
  - Slack `/kodiai profile` output and opt controls
  - opt-out truthfulness in lower-frequency messaging paths

## Executive summary
- S03 is now mostly a **verification-harness slice**, not an architecture slice. S01 and S02 already landed the runtime contract and downstream projections.
- The fastest, lowest-risk path is to add **one new verifier script plus its tests and package entrypoint**, reusing existing exported seams instead of changing runtime behavior.
- The strongest reuse point is `scripts/verify-m045-s01.ts`: it already provides the five-scenario GitHub review matrix, named checks, human output, JSON output, and stable fixture builders. S03 should **compose** it, not recreate it.
- New S03 work is mainly the missing cross-surface checks for:
  1. retrieval hint inclusion/exclusion,
  2. Slack profile card / opt-in / opt-out / help copy,
  3. identity-link DM opt-out truthfulness.
- No external docs were needed. This follows the existing Bun/TypeScript proof-harness pattern already used in `scripts/verify-m041-s02.ts`, `scripts/verify-m042-s02.ts`, `scripts/verify-m042-s03.ts`, and `scripts/verify-m045-s01.ts`.

## Skill discovery
Per the **find-skills** workflow, I only searched the core technologies directly involved in this slice.

Installed skills already relevant enough:
- `github-workflows` / `gh` exist, but they are not needed here because S03 is a local Bun verifier, not CI or GitHub API work.
- No Bun-specific or Slack-specific installed skill is directly better than existing repo patterns.

Promising external skills (not installed):
- **Bun runtime**: `npx skills add sickn33/antigravity-awesome-skills@bun-development`
  - Highest-result Bun match (1.7K installs).
- **Slack slash commands**: `npx skills add stablyai/agent-slack@agent-slack`
  - Best Slack-specific match (936 installs).
- **GitHub review**: `npx skills add ruvnet/ruflo@github-code-review`
  - Relevant but low-value here because S03 does not need live GitHub review automation.

## Implementation landscape
### Existing proof-harness pattern to copy
- `scripts/verify-m045-s01.ts`
  - Canonical M045 verifier style already in use.
  - Exports scenario IDs, check IDs, fixture builders, evaluator, human renderer, JSON mode, and exit-code handling.
  - **Best reuse seam for the GitHub review surface.**
- `scripts/verify-m045-s01.test.ts`
  - Shows the expected testing shape for a verifier script: real passing fixtures plus intentionally malformed fixtures for named failure diagnostics.
- `scripts/verify-m042-s02.ts` and `scripts/verify-m042-s03.ts`
  - Good examples of smaller proof harnesses that import shared expectations from another verifier instead of duplicating surface logic.
- `scripts/verify-m041-s02.ts`
  - Good example of a larger multi-check verifier with an in-memory fixture and one top-level `evaluate...()` report.

### Runtime seams S03 should verify, not rewrite
- `src/contributor/experience-contract.ts`
  - Source of truth for contract states and projections.
  - Key exports for S03:
    - `projectContributorExperienceContract()`
    - `resolveContributorExperienceRetrievalHint()`
  - Also contains the Slack-profile projection logic, but the operator verifier should still check handler output, not only this projection helper.
- `src/slack/slash-command-handler.ts`
  - `handleKodiaiCommand()` owns:
    - `/kodiai profile` card text
    - `profile opt-out`
    - `profile opt-in`
    - unknown-command help text
  - Important constraint: these response strings are **inline**, not exported constants.
- `src/handlers/identity-suggest.ts`
  - `suggestIdentityLink()` owns the DM copy for unlinked contributors.
  - Exports `resetIdentitySuggestionStateForTests()`; S03 should use that reset seam because the module caches Slack members and suggested usernames in module state.
  - Uses `fetch()` against Slack APIs, so the verifier must stub and restore `globalThis.fetch` deterministically.
- `src/knowledge/multi-query-retrieval.ts`
  - **Live review retrieval path**; `review.ts` calls `buildRetrievalVariants()` with `authorHint`.
  - This is the highest-priority retrieval seam for S03.
- `src/knowledge/retrieval-query.ts`
  - Legacy/single-query helper; not live in `review.ts`, but still aligned in S02 and worth checking to prevent silent drift.
- `src/handlers/review.ts`
  - Live path confirms the reviewer uses `resolveContributorExperienceRetrievalHint()` and passes the result into `buildRetrievalVariants()`.
  - The relevant integration is at the `authorHint` → `buildRetrievalVariants()` seam, not a new contract computation seam.
- `package.json`
  - Currently has `verify:m045:s01` only. S03 needs a new entrypoint such as `verify:m045:s03`.

### Existing tests that already define truth
- `src/contributor/experience-contract.test.ts`
  - Pins retrieval-hint mapping and Slack-profile projection behavior.
- `src/slack/slash-command-handler.test.ts`
  - Pins exact profile card, opt-in/out, and help copy.
- `src/handlers/identity-suggest.test.ts`
  - Pins exact DM text and the fail-open Slack API path.
- `src/knowledge/multi-query-retrieval.test.ts`
  - Pins `author:` hint normalization and omission.
- `src/knowledge/retrieval-query.test.ts`
  - Pins legacy `Author:` omission / inclusion.
- `src/handlers/review.test.ts`
  - Confirms the live review path includes `author: new contributor` for profile-backed state and omits all contributor vocabulary for generic opt-out.
  - Useful as evidence, but its helper fixtures are test-local and should **not** be imported into the verifier.

## Key findings and surprises
1. **Most of the slice can live entirely under `scripts/`.**
   - The slice directory is empty today.
   - There is no existing `verify-m045-s03.ts` or `verify:m045:s03` package script.
   - Production exports are already sufficient for a local deterministic verifier.

2. **GitHub review verification is already solved.**
   - `evaluateM045S01()` returns the exact named checks and scenario metadata S03 needs for the review surface.
   - Re-implementing those checks in S03 would create drift immediately.

3. **Slack profile output is reachable only for linked-profile states.**
   - `/kodiai profile` reads the stored profile from `getBySlackUserId()` and projects from that.
   - Realistic Slack handler scenarios are:
     - linked profile-backed,
     - linked opted-out,
     - malformed stored tier → generic fallback.
   - `coarse-fallback` and `generic-degraded` exist in the contract, but are not naturally emitted by `handleKodiaiCommand()` today.

4. **Retrieval verification should prioritize the live builder, then optionally guard the legacy builder.**
   - `review.ts` uses `buildRetrievalVariants()`.
   - `buildRetrievalQuery()` is still present and tested, but it is not the live review path.
   - If scope gets tight, cover `multi-query-retrieval.ts` first.

5. **Identity-suggest is the hidden drift surface for opt-out truthfulness.**
   - The roadmap language only names Slack profile/retrieval/review surfaces, but S02 explicitly extended the contract into identity-link messaging.
   - This DM is still inline-copy + fetch-based + cached, so it is exactly the kind of lesser-used path S03 should protect.

6. **The verifier should keep its expectations independent.**
   - `slash-command-handler.ts` and `identity-suggest.ts` currently inline their strings.
   - Do **not** build the verifier by reusing the same text generator logic for expected output, or it will stop detecting drift.
   - Use exported runtime seams to drive fixtures, but keep the required/banned phrase expectations in the verifier itself, just like `verify-m045-s01.ts` does.

7. **Use deterministic local fixtures only.**
   - Following the repo’s existing verifier pattern and the `verification-before-completion` rule, S03 should be a local operator command with in-memory stores + fetch stubs, not live Slack/GitHub calls.

## Recommended task seams
### Task 1 — Define the S03 report shape and surface matrix
Create the new verifier scaffold first:
- `scripts/verify-m045-s03.ts`
- `scripts/verify-m045-s03.test.ts`
- `package.json` script entry

Recommended report shape:
- top-level `command`, `generatedAt`, `check_ids`, `overallPassed`, `checks`
- a `githubReview` subsection that embeds or references the full `evaluateM045S01()` report
- surface-specific subsections for retrieval, slackProfile, and optOutMessaging

Important: if S03 composes S01, preserve **named check results**. Do not collapse S01 to one boolean, because the roadmap explicitly wants named pass/fail output.

### Task 2 — Add retrieval drift checks
Suggested verifier scope:
- profile-backed fixture → intent query includes `author: new contributor` or another normalized contract hint
- coarse-fallback fixture → intent query includes `author: returning contributor`
- generic states (`generic-unknown`, `generic-opt-out`, `generic-degraded`) → no `author:` fragment and no raw tier vocabulary
- optionally run the same expectation against both:
  - `buildRetrievalVariants()` (live path)
  - `buildRetrievalQuery()` (legacy guard)

Natural fixture seam:
- Build explicit contract fixtures with `projectContributorExperienceContract()`.
- Feed explicit `authorHint` expectations into retrieval builders.
- Keep required/banned retrieval phrases in the verifier, not derived from `resolveContributorExperienceRetrievalHint()`.

### Task 3 — Add Slack profile and command-copy checks
Use `handleKodiaiCommand()` with a tiny in-memory `ContributorProfileStore` stub.

Recommended checks:
- linked profile card shows linked-guidance status, hides raw tier/score fields, shows expertise only when allowed
- opted-out profile card stays generic and suppresses expertise
- malformed stored tier data falls back to generic status text
- `profile opt-out` response says reviews become generic until opt-in
- `profile opt-in` response says linked-profile guidance is back
- unknown-command help still lists both opt controls

This is all reachable with local stubs; no network needed.

### Task 4 — Add identity-link / opt-out truthfulness checks
Use `suggestIdentityLink()` with stubbed `globalThis.fetch` and `resetIdentitySuggestionStateForTests()` around each scenario.

Recommended checks:
- high-confidence match DM says linked profile is used **when available**
- DM explicitly points users to `/kodiai profile opt-out`
- DM does **not** say `personalized code reviews`
- Slack API failures remain non-blocking and become a named warning-style pass/fail check if desired

This is the best place to retire the “opt-out truthfulness” risk outside the main review surface.

## What to build or prove first
1. **Wire S03 to S01 first.**
   - If the verifier cannot embed/report `evaluateM045S01()`, the operator still won’t have one command for the full contract.
2. **Then implement retrieval checks.**
   - They are the smallest new cross-surface proof and directly cover the S02 architectural seam.
3. **Then Slack profile/opt-control checks.**
   - Straightforward local stubs, no network.
4. **Then identity-suggest DM checks.**
   - Slightly trickier because of module cache + fetch stubbing, but still deterministic.
5. **Last, polish human output + JSON output + exit signaling.**
   - Follow the existing `build...ProofHarness()` pattern exactly.

## Verification baseline
Fresh evidence gathered during research:
- `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts ./scripts/verify-m045-s01.test.ts`
  - **55 pass / 0 fail**
- `bun run verify:m045:s01 -- --json`
  - **PASS** with `overallPassed: true` and all 10 GitHub review checks green

This confirms S01/S02 surfaces are currently stable enough for S03 to focus on packaging them into one operator command.

## Verification plan for S03
Minimum completion bar:
- `bun test ./scripts/verify-m045-s03.test.ts`
- `bun run verify:m045:s03`
- `bun run verify:m045:s03 -- --json`
- regression guard suite:
  - `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts ./scripts/verify-m045-s01.test.ts ./scripts/verify-m045-s03.test.ts`

Nice-to-have final smoke check:
- `bun run verify:m045:s01 -- --json && bun run verify:m045:s03 -- --json`

## Recommendation
Treat S03 as a **composition verifier**:
- reuse `evaluateM045S01()` for GitHub review truth,
- add independent retrieval/Slack/DM checks in `scripts/verify-m045-s03.ts`,
- keep all expectations local to the verifier so it can actually detect contract drift,
- avoid runtime refactors unless a tiny helper extraction is needed for deterministic fixtures.

That gives the planner a clean slice with minimal blast radius: one new proof harness, one test file, one package script, and no required behavior changes unless an actual drift bug is discovered while building the verifier.
