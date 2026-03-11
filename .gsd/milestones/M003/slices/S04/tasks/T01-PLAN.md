# T01: 25-reporting-tools 01

**Slice:** S04 — **Milestone:** M003

## Description

Create a self-contained CLI script at `scripts/usage-report.ts` that opens the telemetry SQLite database in read-only mode and surfaces usage, cost, and duration metrics with filtering and multiple output formats.

Purpose: Operators need visibility into Kodiai resource consumption -- which repos cost the most, how many tokens are used, and how execution duration varies by event type. This is the final piece of the v0.3 observability story.

Output: Working `scripts/usage-report.ts`, updated `tsconfig.json` and `package.json`.

## Must-Haves

- [ ] "Running `bun scripts/usage-report.ts` prints a human-readable summary with total executions, total tokens, and total cost"
- [ ] "Running with `--since 7d` filters to last 7 days; `--since 2026-01-01` filters from that date"
- [ ] "Running with `--repo owner/name` filters to a single repo"
- [ ] "Running with `--json` outputs structured JSON suitable for piping to jq"
- [ ] "Running with `--csv` outputs CSV with headers suitable for piping to a file"
- [ ] "The default output includes a ranked list of repos by cost"
- [ ] "The output includes avg duration per event type (review vs mention)"
- [ ] "Running with `--help` shows usage information"

## Files

- `scripts/usage-report.ts`
- `tsconfig.json`
- `package.json`
