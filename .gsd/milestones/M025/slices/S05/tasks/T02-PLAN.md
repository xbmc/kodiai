# T02: 124-publishing 02

**Slice:** S05 — **Milestone:** M025

## Description

Create the CLI entry point script for publishing wiki update suggestions to GitHub.

Purpose: Provide a standalone script (following generate-wiki-updates.ts pattern) that operators run to publish suggestions as GitHub issue comments.
Output: `scripts/publish-wiki-updates.ts` runnable via `bun scripts/publish-wiki-updates.ts`

## Must-Haves

- [ ] Script is runnable via bun scripts/publish-wiki-updates.ts
- [ ] Script verifies GitHub App installation before publishing (delegates to publisher module)
- [ ] --dry-run flag prints formatted markdown to stdout without calling GitHub API
- [ ] --dry-run --output file.md writes formatted output to a file
- [ ] --page-ids 123,456 publishes only specific pages
- [ ] --grounded-only flag skips suggestions with voice mismatch warnings
- [ ] --owner and --repo flags allow targeting different repos for testing
- [ ] Progress logging per page during live run with final summary banner
- [ ] Script exits 0 on success, 1 on fatal error

## Files

- `scripts/publish-wiki-updates.ts`
