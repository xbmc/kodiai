# T03: 123-update-generation 03

**Slice:** S04 — **Milestone:** M025

## Description

Create the CLI entry point script that runs the wiki update generation pipeline.

Purpose: Provide a standalone manual-trigger script (like existing backfill scripts) that operators run to generate wiki update suggestions for the most popular stale pages.
Output: `scripts/generate-wiki-updates.ts` runnable via `bun scripts/generate-wiki-updates.ts`

## Must-Haves

- [ ] Script processes top 20 pages by default (configurable via --top-n flag)
- [ ] Script supports --dry-run flag that skips DB writes
- [ ] Script supports --page-ids flag to target specific pages
- [ ] Script logs summary with pages processed, suggestions generated, suggestions dropped, duration
- [ ] Script exits cleanly with process.exit(0) on success, process.exit(1) on fatal error

## Files

- `scripts/generate-wiki-updates.ts`
