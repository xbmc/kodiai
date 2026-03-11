# S04: Reporting Tools

**Goal:** Create a self-contained CLI script at `scripts/usage-report.
**Demo:** Create a self-contained CLI script at `scripts/usage-report.

## Must-Haves


## Tasks

- [x] **T01: 25-reporting-tools 01** `est:2min`
  - Create a self-contained CLI script at `scripts/usage-report.ts` that opens the telemetry SQLite database in read-only mode and surfaces usage, cost, and duration metrics with filtering and multiple output formats.

Purpose: Operators need visibility into Kodiai resource consumption -- which repos cost the most, how many tokens are used, and how execution duration varies by event type. This is the final piece of the v0.3 observability story.

Output: Working `scripts/usage-report.ts`, updated `tsconfig.json` and `package.json`.

## Files Likely Touched

- `scripts/usage-report.ts`
- `tsconfig.json`
- `package.json`
