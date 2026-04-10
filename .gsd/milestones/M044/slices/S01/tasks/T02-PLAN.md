---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T02: Build the GitHub-visible recent review collector and lane-stratified selector

Create focused review-audit modules that use the existing GitHub App bootstrap to scan the authoritative Kodiai output surfaces on recent `xbmc/xbmc` PRs. Extract marker-backed artifacts, keep the latest Kodiai artifact per PR, classify lane from parsed key action, and apply the up-to-six-per-lane fill rule deterministically. Record which GitHub surface produced the artifact and the URLs/operators needed for drill-down.

## Inputs

- `src/auth/github-app.ts`
- `src/handlers/review-idempotency.ts`
- `docs/runbooks/review-requested-debug.md`

## Expected Output

- `src/review-audit/recent-review-sample.ts`
- `src/review-audit/recent-review-sample.test.ts`

## Verification

bun test ./src/review-audit/recent-review-sample.test.ts

## Observability Impact

Make sample-selection metadata first-class: lane counts, fill decisions, GitHub surfaces hit, and skipped/no-marker cases become reportable rather than implicit script behavior.
