# S05: Publishing

**Goal:** Create the wiki publisher module that posts update suggestions as structured comments on a GitHub tracking issue.
**Demo:** Create the wiki publisher module that posts update suggestions as structured comments on a GitHub tracking issue.

## Must-Haves


## Tasks

- [x] **T01: 124-publishing 01** `est:8min`
  - Create the wiki publisher module that posts update suggestions as structured comments on a GitHub tracking issue.

Purpose: Core publishing logic — pre-flight check, issue creation, comment formatting, rate-limited posting, summary table with anchor links, DB idempotency marking.
Output: `src/knowledge/wiki-publisher.ts` module, types, migration, and unit tests.
- [x] **T02: 124-publishing 02** `est:3min`
  - Create the CLI entry point script for publishing wiki update suggestions to GitHub.

Purpose: Provide a standalone script (following generate-wiki-updates.ts pattern) that operators run to publish suggestions as GitHub issue comments.
Output: `scripts/publish-wiki-updates.ts` runnable via `bun scripts/publish-wiki-updates.ts`

## Files Likely Touched

- `src/db/migrations/024-wiki-update-publishing.sql`
- `src/db/migrations/024-wiki-update-publishing.down.sql`
- `src/knowledge/wiki-publisher.ts`
- `src/knowledge/wiki-publisher-types.ts`
- `src/knowledge/wiki-publisher.test.ts`
- `scripts/publish-wiki-updates.ts`
