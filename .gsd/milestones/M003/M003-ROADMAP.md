# M003: Configuration & Observability

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Config Validation Safety** `risk:medium` `depends:[]`
  > After this: Make .
- [x] **S02: Telemetry Foundation** `risk:medium` `depends:[S01]`
  > After this: Create the TelemetryStore module with SQLite-backed persistent storage for execution telemetry, using TDD to ensure correctness of insert, purge, and checkpoint operations.
- [x] **S03: Enhanced Config Fields** `risk:medium` `depends:[S02]`
  > After this: Add `allowedUsers` field to mention config and upgrade `skipPaths` matching to picomatch globs.
- [x] **S04: Reporting Tools** `risk:medium` `depends:[S03]`
  > After this: Create a self-contained CLI script at `scripts/usage-report.
