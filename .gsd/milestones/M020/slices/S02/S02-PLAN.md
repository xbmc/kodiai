# S02: Contributor Profiles Identity Linking

**Goal:** Create the contributor profiles schema, types, and data store -- the foundation for identity linking, expertise tracking, and privacy controls.
**Demo:** Create the contributor profiles schema, types, and data store -- the foundation for identity linking, expertise tracking, and privacy controls.

## Must-Haves


## Tasks

- [x] **T01: 98-contributor-profiles-identity-linking 01** `est:8min`
  - Create the contributor profiles schema, types, and data store -- the foundation for identity linking, expertise tracking, and privacy controls.

Purpose: All subsequent plans depend on the profile table and store for reading/writing contributor data.
Output: Migration 011, contributor types, profile store with tests.
- [x] **T02: 98-contributor-profiles-identity-linking 02** `est:6min`
  - Build the Slack slash command endpoint and handler for identity linking, unlinking, profile viewing, and opt-out -- the user-facing interaction surface for contributor profiles.

Purpose: This is the single entry point for cross-platform identity linking (Slack is the entry point, per user decision).
Output: Hono route for slash commands, handler with subcommand dispatch, tests.
- [x] **T03: 98-contributor-profiles-identity-linking 03** `est:8min`
  - Build the expertise scoring engine, tier calculator, and identity matcher -- the intelligence layer that turns raw GitHub activity into structured expertise profiles.

Purpose: This is the core algorithm that drives adaptive review behavior (Plan 04).
Output: Expertise scorer with decay, tier calculator with percentiles, identity matcher with heuristics.
- [x] **T04: 98-contributor-profiles-identity-linking 04** `est:12min`
  - Wire contributor profiles into the review pipeline and mount the slash command route -- the integration plan that makes profiles actually affect behavior.

Purpose: This plan connects all the pieces: profile lookup in review flow, 4-tier prompt adaptation, incremental expertise updates, identity suggestion DMs, and slash command route mounting.
Output: Working end-to-end flow from profile lookup through adapted review prompts.

## Files Likely Touched

- `src/db/migrations/011-contributor-profiles.sql`
- `src/db/migrations/011-contributor-profiles.down.sql`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/profile-store.test.ts`
- `src/contributor/index.ts`
- `src/slack/slash-command-handler.ts`
- `src/slack/slash-command-handler.test.ts`
- `src/routes/slack-commands.ts`
- `src/routes/slack-commands.test.ts`
- `src/contributor/expertise-scorer.ts`
- `src/contributor/expertise-scorer.test.ts`
- `src/contributor/tier-calculator.ts`
- `src/contributor/tier-calculator.test.ts`
- `src/contributor/identity-matcher.ts`
- `src/contributor/identity-matcher.test.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `src/lib/author-classifier.ts`
- `src/index.ts`
- `src/contributor/index.ts`
