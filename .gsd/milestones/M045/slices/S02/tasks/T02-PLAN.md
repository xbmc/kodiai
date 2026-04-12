---
estimated_steps: 5
estimated_files: 6
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T02: Make Slack profile, opt-in/out, and identity suggestions contract-first

**Slice:** S02 — Unified Slack, Opt-Out, and Retrieval Semantics
**Milestone:** M045

## Description

Slack `/kodiai profile`, opt-in/out responses, and identity suggestion DMs are the remaining user-visible promises outside the GitHub review prompt/details surface. This task makes those surfaces consume contract-first wording rather than raw tier strings. Assume the safest product behavior: the Slack profile card stops surfacing raw `Tier` / `Score` lines entirely, leads with contract/status language, and keeps expertise as secondary context only when it does not contradict the resolved contract state. Identity suggestion DMs must stay fail-open and truthful: they may invite the user to link a profile-backed contributor signal, but they cannot promise “personalized code reviews,” and they should remind the user that opt-out remains available.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `ContributorProfileStore` profile lookups | Return the existing 'no profile found' flow or generic contract wording; never crash the slash command. | Treat the profile as unavailable and keep the response fail-open. | Ignore malformed stored tier/score data and avoid rendering raw tier semantics. |
| Slack `users.list` / `conversations.open` / `chat.postMessage` in `identity-suggest.ts` | Log and fail open exactly as today; no review path should block on DM delivery. | Preserve existing timeout handling and send no DM. | Drop malformed Slack responses and keep the suggestion path non-blocking. |
| Contract-first Slack projection helper | Fall back to neutral/generic wording rather than exposing raw tier or 'personalized review' promises. | N/A — pure in-process projection. | Treat unsupported states as generic copy and hide raw tier/score lines. |

## Load Profile

- **Shared resources**: Slack slash-command profile reads, expertise lookups, and the cached `users.list` member snapshot used for identity suggestions.
- **Per-operation cost**: one profile lookup plus optional expertise lookup for `/kodiai profile`; identity suggestions reuse the one-hour member cache and send at most one DM per suggested username.
- **10x breakpoint**: Slack API quota or member-cache churn would fail first, so the task must keep copy changes local and avoid adding extra network round-trips.

## Negative Tests

- **Malformed inputs**: unknown slash subcommands, malformed stored tier data, and empty expertise arrays still render contract-first neutral copy.
- **Error paths**: no linked profile, existing linked profile, Slack API failure, and no high-confidence identity match all stay fail-open without sending misleading messages.
- **Boundary conditions**: opted-out users never see raw tier/score or 'personalized code reviews'; help text advertises both `profile opt-in` and `profile opt-out`; high-confidence matches produce one truthful DM body.

## Steps

1. Add Slack/profile projection helpers and contract-focused regression cases in `src/contributor/experience-contract.test.ts` so Slack surfaces can render contract-first copy without reading raw tier strings directly.
2. Update `src/slack/slash-command-handler.ts` so `/kodiai profile` leads with contract/status wording, hides raw `Tier` / `Score` lines, preserves expertise as secondary context when appropriate, and keeps no-profile behavior unchanged.
3. Align `profile opt-out`, `profile opt-in`, and unknown-command help text in `src/slack/slash-command-handler.ts`, then pin the exact responses in `src/slack/slash-command-handler.test.ts`.
4. Add `src/handlers/identity-suggest.test.ts` with mocked Slack fetches that cover existing-link suppression, no-match suppression, one truthful DM body for a high-confidence match, and Slack API fail-open behavior.
5. Update `src/handlers/identity-suggest.ts`, rerun the targeted Slack/identity tests, and finish with `bun run tsc --noEmit`.

## Must-Haves

- [ ] `/kodiai profile` renders contract-first wording and never shows raw tier/score semantics alongside generic or opted-out behavior.
- [ ] `profile opt-out`, `profile opt-in`, and help text all describe the same contract truth and advertise both opt controls.
- [ ] Identity suggestion DMs stay non-blocking, stop promising personalized reviews, and tell the truth about linked-profile guidance plus opt-out availability.

## Verification

- `bun test ./src/contributor/experience-contract.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: Slack response text and identity-suggest DM bodies become contract-aligned user-visible diagnostics, while existing warn/info logs stay fail-open.
- How a future agent inspects this: run the targeted Slack/identity tests and inspect mocked slash-command responses plus posted DM payloads.
- Failure state exposed: contradictory opt-out copy, missing `profile opt-in` help, or stale “personalized code reviews” wording fail exact-string assertions.

## Inputs

- `src/contributor/experience-contract.ts` — contract seam that needs Slack-facing projection helpers alongside the existing prompt/detail projections.
- `src/contributor/experience-contract.test.ts` — shared contract regression suite to extend with Slack copy expectations.
- `src/slack/slash-command-handler.ts` — current Slack surface that still renders raw `Tier` / `Score` lines and incomplete help text.
- `src/slack/slash-command-handler.test.ts` — existing slash-command regression harness that already covers link/unlink/profile basics.
- `src/handlers/identity-suggest.ts` — current DM path that still promises 'personalized code reviews' and has no dedicated direct tests.

## Expected Output

- `src/contributor/experience-contract.ts` — Slack/profile projection helper(s) that render contract-first user-facing wording.
- `src/contributor/experience-contract.test.ts` — focused contract tests covering Slack-facing projection behavior.
- `src/slack/slash-command-handler.ts` — profile card, opt-in/out responses, and help text updated to contract-first semantics.
- `src/slack/slash-command-handler.test.ts` — assertions that opted-out users see generic contract wording and help text advertises both opt controls.
- `src/handlers/identity-suggest.ts` — DM copy updated to truthful linked-profile guidance with explicit opt-out safety.
- `src/handlers/identity-suggest.test.ts` — new direct regression harness for no-profile, existing-link, no-match, high-confidence-match, and Slack-failure cases.
