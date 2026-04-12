---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T04: Ship the S01 verifier command and run the first live recent-review audit

Package the collector and correlator behind a deterministic S01 verifier script following the repo's existing `verify:*` conventions. Add CLI parsing, human-readable plus JSON output, stable per-PR evidence records, and truthful preflight reporting for missing GitHub/DB/log access. Wire a `verify:m044:s01` package script and exercise it against the recent `xbmc/xbmc` sample so the slice closes on a real audit report rather than unit tests alone.

## Inputs

- `src/review-audit/recent-review-sample.ts`
- `src/review-audit/evidence-correlation.ts`
- `package.json`
- `.gsd/milestones/M044/M044-RESEARCH.md`

## Expected Output

- `scripts/verify-m044-s01.ts`
- `scripts/verify-m044-s01.test.ts`
- `package.json`

## Verification

bun test ./scripts/verify-m044-s01.test.ts && bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json

## Observability Impact

Creates the stable S01 operator surface: one command that prints preflight status, selection metadata, per-PR evidence, and provisional verdicts instead of scattering that information across ad-hoc script logs.
