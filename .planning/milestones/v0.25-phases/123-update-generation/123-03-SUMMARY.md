---
phase: 123-update-generation
plan: 03
status: complete
---

# Plan 123-03 Summary: CLI script entry point

## What Was Built
- `scripts/generate-wiki-updates.ts` — standalone CLI script following the backfill-wiki.ts pattern
- Supports `--top-n` (default 20), `--page-ids`, `--dry-run`, `--rate-limit` (default 300ms), `--help` flags
- Wires DB client, migrations, wiki page store, task router, telemetry store, and cost tracker
- Prints summary table on completion with pages/sections/suggestions/dropped/mismatches/duration

## Key Decisions
- Uses `createTelemetryStore` + `createCostTracker` for LLM cost tracking (first script to use LLM calls)
- Uses `createTaskRouter({ models: {} })` with empty overrides (same pattern as index.ts)
- `createWikiPageStore` called without embeddingModel (not doing embeddings)
- Hardcoded githubOwner="xbmc", githubRepo="xbmc" (single-wiki project)

## Key Files
- `scripts/generate-wiki-updates.ts` (created)

## Commit
`d4a3f59605` — feat(123): add CLI script for wiki update generation
