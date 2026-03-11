# T04: 98-contributor-profiles-identity-linking 04

**Slice:** S02 — **Milestone:** M020

## Description

Wire contributor profiles into the review pipeline and mount the slash command route -- the integration plan that makes profiles actually affect behavior.

Purpose: This plan connects all the pieces: profile lookup in review flow, 4-tier prompt adaptation, incremental expertise updates, identity suggestion DMs, and slash command route mounting.
Output: Working end-to-end flow from profile lookup through adapted review prompts.

## Must-Haves

- [ ] "High-expertise contributors in their strong areas get terse, direct reviews focused on architecture"
- [ ] "Newcomers get explanatory reviews with WHY reasoning, doc links, and encouraging tone"
- [ ] "Adaptation is invisible -- no badges or indicators, reviews just naturally read differently"
- [ ] "Contributors without profiles fall back to existing classifyAuthor behavior"
- [ ] "Expertise is incrementally updated after each PR review (fire-and-forget)"
- [ ] "Slash command route is mounted and accessible at /webhooks/slack/commands"
- [ ] "Identity suggestions are sent as DMs when unlinked GitHub users appear in PRs"

## Files

- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `src/lib/author-classifier.ts`
- `src/index.ts`
- `src/contributor/index.ts`
