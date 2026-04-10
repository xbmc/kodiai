# S02: Unified Slack, Opt-Out, and Retrieval Semantics — UAT

**Milestone:** M045
**Written:** 2026-04-09T17:29:30.699Z

## Preconditions

- Run from the repository root with Bun installed.
- No live GitHub, Slack, or database credentials are required; this slice is proven with deterministic fixtures and unit tests.
- The working tree contains the S02 implementation.

## Test Case 1 — Linked `/kodiai profile` stays contract-first

1. Run `bun test ./src/slack/slash-command-handler.test.ts`.
2. Confirm the named test `profile with linked profile returns contract-first card` passes.
3. Expected outcome:
   - the rendered profile card contains `*Contributor Profile*`, `GitHub: \`octocat\``, `Status: Linked contributor guidance is active.`, and `Kodiai can adapt review guidance using your linked contributor profile.`
   - `*Top Expertise:*` is still shown for linked/profile-backed guidance.
4. Edge-case guard:
   - the same output does **not** contain `Tier:` or `Score:`.

## Test Case 2 — Opted-out and malformed profiles stay generic in Slack

1. Run `bun test ./src/slack/slash-command-handler.test.ts`.
2. Confirm these named tests pass:
   - `profile with opted-out profile stays generic and hides expertise`
   - `profile with malformed stored tier data falls back to neutral contract copy`
3. Expected outcome for opted-out profiles:
   - the card contains `Status: Generic contributor guidance is active.`
   - the summary says `You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.`
   - `Top Expertise`, `Tier:`, and `Score:` are absent.
4. Expected outcome for malformed stored tiers:
   - the card says `Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.`
   - no raw tier/score fallback text is shown.

## Test Case 3 — Opt-out, opt-in, and help copy all tell the same contract truth

1. Run `bun test ./src/slack/slash-command-handler.test.ts`.
2. Confirm these named tests pass:
   - `profile opt-out sets opted_out to true and advertises opt-in`
   - `profile opt-in re-enables profiling and advertises opt-out`
   - `unknown subcommand returns help text with both opt controls`
3. Expected outcome:
   - `profile opt-out` returns `Contributor-specific guidance is now off. Kodiai will keep your reviews generic until you run /kodiai profile opt-in...`
   - `profile opt-in` returns `Contributor-specific guidance is now on for your linked profile... /kodiai profile opt-out ...`
   - unknown-command help lists `profile`, `profile opt-in`, and `profile opt-out` together.
4. Edge-case guard:
   - none of these responses mention contributor tiers, scores, or personalized-review promises.

## Test Case 4 — Review retrieval uses contract-approved hints only

1. Run `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts`.
2. Confirm these named tests pass:
   - `resolveContributorExperienceRetrievalHint > emits normalized hints only for adapted contract states`
   - `resolveContributorExperienceRetrievalHint > emits no retrieval hint for generic contract states`
   - `buildRetrievalQuery > full signals — query includes all signal types with a normalized author hint`
   - `buildRetrievalQuery > empty author hints are omitted after normalization`
   - `buildRetrievalVariants > intent variant drops empty author hints after normalization`
   - `passes a normalized retrieval hint for profile-backed review retrieval`
   - `omits retrieval hints for generic contributor-experience states`
3. Expected outcome:
   - profile-backed retrieval uses normalized text such as `Author: new contributor` or `author: new contributor`, never raw stored values like `newcomer`.
   - coarse fallback collapses to `returning contributor`.
   - generic opt-out, generic unknown, generic degraded, and malformed contract inputs emit no author hint at all.
4. Edge-case guard:
   - generic-state queries must not contain `author:` and must not leak raw tier words such as `newcomer`, `regular`, `core`, `established`, or `senior`.

## Test Case 5 — Identity suggestions stay truthful and fail open

1. Run `bun test ./src/handlers/identity-suggest.test.ts`.
2. Confirm these named tests pass:
   - `existing linked profile suppresses Slack lookup and DM delivery`
   - `no high-confidence match stays fail-open without opening a DM`
   - `high-confidence match sends one truthful DM body`
   - `Slack API failures stay non-blocking and log a warning`
3. Expected outcome for the high-confidence match case:
   - the DM text says `link your accounts with /kodiai link octocat so Kodiai can use your linked contributor profile when available.`
   - the DM also says `If you'd rather keep reviews generic, you can opt out any time with /kodiai profile opt-out.`
4. Edge-case guard:
   - the DM text does **not** contain `personalized code reviews`, and Slack API failures do not throw through the caller.

## Test Case 6 — Cross-surface GitHub contract and type safety stay green after S02

1. Run `bun run verify:m045:s01 -- --json`.
   - Expected: exit 0 with `overallPassed: true` and all 10 check IDs passing.
2. Run `bun run tsc --noEmit`.
   - Expected: exit 0.
3. Expected outcome:
   - S02 does not regress the existing GitHub review prompt/details contract while extending Slack/retrieval semantics.
   - TypeScript still compiles cleanly after the retrieval API rename from `authorTier` to optional `authorHint`.
