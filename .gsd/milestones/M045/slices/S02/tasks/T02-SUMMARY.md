---
id: T02
parent: S02
milestone: M045
key_files:
  - src/contributor/experience-contract.ts
  - src/contributor/experience-contract.test.ts
  - src/slack/slash-command-handler.ts
  - src/slack/slash-command-handler.test.ts
  - src/handlers/identity-suggest.ts
  - src/handlers/identity-suggest.test.ts
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D069 — Slack contributor surfaces project contract status copy instead of raw tier/score semantics.
  - Stateful Slack identity-suggestion tests reset module cache explicitly to keep fetch-order and fail-open assertions deterministic.
duration: 
verification_result: passed
completed_at: 2026-04-09T17:18:34.239Z
blocker_discovered: false
---

# T02: Made Slack profile and identity-link messaging use contract-first contributor guidance.

**Made Slack profile and identity-link messaging use contract-first contributor guidance.**

## What Happened

Added a Slack-facing contributor-experience projection that turns stored contributor state into contract-first status and summary copy, including safe fallback for malformed tier data. Reworked `/kodiai profile` to hide raw tier/score lines, suppress expertise on generic states, and aligned `profile opt-in`, `profile opt-out`, and unknown-command help text around the same contract truth. Added direct identity-suggest coverage, updated the DM body to truthful linked-profile guidance plus opt-out availability, and made the suggestion path fail open with an explicit cache reset seam for deterministic tests.

## Verification

`bun test ./src/contributor/experience-contract.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts` passed, proving the new contract helper, slash-command copy, and identity-suggest behavior. `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts` passed, keeping the broader slice regression surface green. `bun run verify:m045:s01 -- --json` returned `overallPassed: true`, and `bun run tsc --noEmit` exited 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/experience-contract.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts` | 0 | ✅ pass | 26ms |
| 2 | `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts` | 0 | ✅ pass | 3817ms |
| 3 | `bun run verify:m045:s01 -- --json` | 0 | ✅ pass | 40ms |
| 4 | `bun run tsc --noEmit` | 0 | ✅ pass | 7960ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/slack/slash-command-handler.ts`
- `src/slack/slash-command-handler.test.ts`
- `src/handlers/identity-suggest.ts`
- `src/handlers/identity-suggest.test.ts`
- `.gsd/DECISIONS.md`
- `.gsd/KNOWLEDGE.md`
