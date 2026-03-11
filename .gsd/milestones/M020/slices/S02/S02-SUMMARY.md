---
id: S02
parent: M020
milestone: M020
provides:
  - contributor_profiles and contributor_expertise PostgreSQL tables
  - ContributorProfile, ContributorExpertise, ContributorProfileStore types
  - createContributorProfileStore factory with full CRUD
  - computeExpertiseScores batch scorer with GitHub API integration
  - updateExpertiseIncremental fire-and-forget per-PR updater
  - recalculateTiers percentile-based tier assignment
  - findPotentialMatches heuristic identity matching
  - 4-tier profile-aware review prompts with area expertise
  - Profile store integration in review pipeline (fail-open)
  - Fire-and-forget incremental expertise updates after reviews
  - Identity suggestion DMs for unlinked contributors
  - Slash command route mounted at /webhooks/slack/commands
  - handleKodiaiCommand dispatcher for link/unlink/profile/opt-out
  - createSlackCommandRoutes Hono route factory
requires: []
affects: []
key_files: []
key_decisions:
  - "getBySlackUserId does NOT filter opted_out (needed for profile command self-lookup)"
  - "getOrCreateByGithubUsername uses ON CONFLICT DO UPDATE to handle race conditions"
  - "Sigmoid normalization with k=0.05, midpoint=50 for 0-1 bounded scores"
  - "Tier boundaries: zero-score override + 20/50/80 percentiles"
  - "Incremental update uses 90/10 blend (existing * 0.9 + new * 0.1)"
  - "AuthorTier union expanded with 4 new tiers (newcomer/developing/established/senior) keeping backward compat"
  - "Identity suggestion DMs only for high-confidence Levenshtein matches"
  - "Slack member list cached 1 hour in module-level variable (resets on restart)"
  - "Suggested usernames tracked in memory Set to avoid repeat DMs"
  - "Route not yet mounted in index.ts — deferred to Plan 04 for integration wiring"
  - "asyncWork pattern allows immediate 200 response with deferred background work"
patterns_established:
  - "Contributor store follows createXxxStore({ sql, logger }) factory pattern"
  - "Snake_case to camelCase mapping via explicit mapRow helpers"
  - "Expertise scoring uses separate pure math functions testable without DB"
  - "Levenshtein distance for fuzzy identity matching with confidence levels"
  - "Identity suggestion is a separate module (identity-suggest.ts) keeping review handler clean"
  - "All contributor profile operations are fail-open with try/catch and warn logging"
  - "Slash command handler returns SlashCommandResult with optional asyncWork callback"
observability_surfaces: []
drill_down_paths: []
duration: 6min
verification_result: passed
completed_at: 2026-02-25
blocker_discovered: false
---
# S02: Contributor Profiles Identity Linking

**# Plan 98-01: Schema, Types & Profile Store Summary**

## What Happened

# Plan 98-01: Schema, Types & Profile Store Summary

**Contributor profiles schema with two tables, typed store factory, and 10 passing integration tests**

## Performance

- **Duration:** 8 min
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Migration 011 creates contributor_profiles and contributor_expertise with indexes and constraints
- ContributorProfileStore interface covers all CRUD for identity linking, expertise, tiers, opt-out
- 10 integration tests pass against PostgreSQL covering all store operations

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration 011 and contributor types** - `d9009ff` (feat)
2. **Task 2: Implement profile store and tests** - `0da21d7` (feat)

## Files Created/Modified
- `src/db/migrations/011-contributor-profiles.sql` - Schema for profiles and expertise tables
- `src/db/migrations/011-contributor-profiles.down.sql` - Rollback migration
- `src/contributor/types.ts` - ContributorProfile, ContributorExpertise types and store interface
- `src/contributor/profile-store.ts` - createContributorProfileStore factory
- `src/contributor/profile-store.test.ts` - 10 integration tests
- `src/contributor/index.ts` - Barrel export

## Decisions Made
- getBySlackUserId does NOT filter opted_out — needed for profile command self-lookup
- getOrCreateByGithubUsername uses ON CONFLICT DO UPDATE to handle race conditions safely

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Profile store ready for slash commands (Plan 02), expertise scorer (Plan 03), and integration wiring (Plan 04)

---
*Phase: 98-contributor-profiles-identity-linking*
*Completed: 2026-02-25*

# Plan 98-03: Expertise Scoring, Tier Calculator & Identity Matcher Summary

**Two-dimensional expertise scoring with 180-day decay, percentile-based tiers, and Levenshtein identity matching**

## Performance

- **Duration:** 8 min
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Expertise scorer computes language + file_area scores from commits, PRs, reviews with exponential decay
- Incremental updater for fire-and-forget expertise updates after each PR review
- Tier calculator assigns tiers from percentile distribution with zero-score override
- Identity matcher suggests GitHub-Slack links using Levenshtein distance

## Task Commits

1. **Task 1: Expertise scorer** - `0428cfc` (feat)
2. **Task 2: Tier calculator and identity matcher** - `4d107db` (feat)

## Files Created/Modified
- `src/contributor/expertise-scorer.ts` - Decay scoring, sigmoid normalization, batch/incremental functions
- `src/contributor/expertise-scorer.test.ts` - 11 tests covering math functions and store interactions
- `src/contributor/tier-calculator.ts` - Percentile-based tier assignment
- `src/contributor/tier-calculator.test.ts` - 4 tests for tier boundaries and edge cases
- `src/contributor/identity-matcher.ts` - Levenshtein distance, fuzzy name matching
- `src/contributor/identity-matcher.test.ts` - 10 tests for matching scenarios
- `src/contributor/index.ts` - Updated barrel exports

## Decisions Made
- Sigmoid normalization with k=0.05, midpoint=50 produces good score distribution
- Incremental update blends 90% existing + 10% new to avoid wild swings from single PRs
- Zero-score contributors always get "newcomer" regardless of percentile

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None

## Next Phase Readiness
- All scoring, tier, and matching functions ready for integration in Plan 04

---
*Phase: 98-contributor-profiles-identity-linking*
*Completed: 2026-02-25*

# Plan 98-04: Integration Wiring Summary

**Wire contributor profiles into review pipeline with 4-tier prompts, identity suggestion DMs, and slash command routing**

## Performance

- **Duration:** 12 min
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- AuthorTier expanded to include newcomer/developing/established/senior alongside legacy tiers
- buildAuthorExperienceSection handles 4-tier prompt adaptation with area expertise context
- resolveAuthorTier checks contributor profile store first (fail-open fallback to legacy classifyAuthor)
- Fire-and-forget incremental expertise update after each PR review
- Identity suggestion DMs sent to high-confidence Slack matches for unlinked GitHub users
- Slash command route mounted at /webhooks/slack/commands
- Profile store and slackBotToken injected into review handler

## Task Commits

1. **Task 1: 4-tier review prompts and profile-aware tier resolution** - `3eee847` (feat)
2. **Task 2: Slash command route, profile store wiring, identity DMs** - `4d845a3` (feat)

## Files Created/Modified
- `src/handlers/identity-suggest.ts` - Fire-and-forget identity suggestion DMs with Slack member caching
- `src/lib/author-classifier.ts` - AuthorTier union expanded with 4 new tiers
- `src/execution/review-prompt.ts` - 4-tier buildAuthorExperienceSection with area expertise
- `src/handlers/review.ts` - Profile store integration, expertise in author classification, identity suggestion trigger
- `src/index.ts` - Profile store creation, slash command route mounting, token/store injection

## Decisions Made
- Identity suggestion module kept separate from review handler for clean separation
- Only high-confidence matches trigger DMs to avoid spam
- Module-level Set tracks suggested usernames (acceptable for v1, resets on restart)

## Deviations from Plan
- Created identity-suggest.ts as a separate handler module instead of a private function in review.ts (cleaner separation of concerns)

## Issues Encountered
None

## User Setup Required
None

## Next Phase Readiness
- Phase 98 integration complete; all PROF requirements addressed

---
*Phase: 98-contributor-profiles-identity-linking*
*Completed: 2026-02-25*

# Plan 98-02: Slash Command Handler & Route Summary

**Slack /kodiai slash commands for identity linking, profile viewing, and opt-out with HMAC-verified route**

## Performance

- **Duration:** 6 min
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- handleKodiaiCommand dispatches link/unlink/profile/opt-out/opt-in subcommands
- GitHub username validation rejects special characters
- Hono route verifies Slack HMAC signatures before dispatch
- All responses are ephemeral (only visible to invoking user)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create slash command handler** - `5e3601f` (feat)
2. **Task 2: Create Hono route** - `5cf09ac` (feat)

## Files Created/Modified
- `src/slack/slash-command-handler.ts` - Command dispatcher with subcommand parsing
- `src/slack/slash-command-handler.test.ts` - 9 unit tests with mocked store
- `src/routes/slack-commands.ts` - Hono route factory for form-encoded payloads
- `src/routes/slack-commands.test.ts` - 3 route-level tests

## Decisions Made
- Route not mounted in index.ts yet — Plan 04 handles integration wiring
- asyncWork pattern enables fire-and-forget background work after immediate 200

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Handler and route ready for mounting in Plan 04
- Profile store dependency injected via constructor, no hard coupling

---
*Phase: 98-contributor-profiles-identity-linking*
*Completed: 2026-02-25*
