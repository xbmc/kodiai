# T01: 98-contributor-profiles-identity-linking 01

**Slice:** S02 — **Milestone:** M020

## Description

Create the contributor profiles schema, types, and data store -- the foundation for identity linking, expertise tracking, and privacy controls.

Purpose: All subsequent plans depend on the profile table and store for reading/writing contributor data.
Output: Migration 011, contributor types, profile store with tests.

## Must-Haves

- [ ] "Contributor profiles can be created with GitHub username and optional Slack user ID"
- [ ] "Expertise entries can be stored and queried per contributor per dimension/topic"
- [ ] "Contributors can opt out and opted-out profiles are excluded from expertise lookups"
- [ ] "Unlinking nulls the Slack user ID but preserves expertise data"

## Files

- `src/db/migrations/011-contributor-profiles.sql`
- `src/db/migrations/011-contributor-profiles.down.sql`
- `src/contributor/types.ts`
- `src/contributor/profile-store.ts`
- `src/contributor/profile-store.test.ts`
- `src/contributor/index.ts`
