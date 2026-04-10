---
estimated_steps: 24
estimated_files: 5
skills_used:
  - test-driven-development
  - systematic-debugging
---

# T02: Build the live xbmc collector and checked-in snapshot writer

**Slice:** S01 — xbmc Fixture Set and Provenance Collector
**Milestone:** M046

## Description

Turn the curated manifest into a deterministic evidence pack. Implement a refresh module that reads the manifest, pulls GitHub-authored PR/review/activity evidence through the existing GitHub App seam, optionally enriches with local `tmp/xbmc` git history when present, normalizes alias mappings, and writes a stable checked-in snapshot sorted by normalized contributor identity. Exclusions must remain visible with reason codes and provenance; missing GitHub access or missing local workspace should degrade the report rather than rewriting the corpus with silent holes.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| GitHub App access via `.env` + `src/auth/github-app.ts` | Surface a named refresh failure/source-unavailable state and keep the last checked-in snapshot truthful instead of inventing evidence. | Retry only within the refresh helper’s bounded logic; do not spin indefinitely. | Reject malformed API payloads as missing evidence for that source and keep provenance explicit. |
| Curated manifest aliases/exclusions | Stop on alias collisions or missing retained contributors rather than writing an ambiguous snapshot. | N/A — local file only. | Fail the refresh when manifest aliases and collected identities disagree in a way the manifest did not authorize. |
| Optional local workspace `tmp/xbmc` | Mark local-git enrichment unavailable and continue with GitHub-only provenance if the workspace is absent. | N/A — local filesystem only. | Ignore malformed shortlog enrichment output unless it can be parsed into explicit provenance entries. |

## Load Profile

- **Shared resources**: GitHub API rate limits, optional local git workspace, and one checked-in snapshot file.
- **Per-operation cost**: one bounded collector pass over the curated contributor set plus a deterministic snapshot write.
- **10x breakpoint**: GitHub API calls and alias reconciliation become the main bottlenecks; keep the curated corpus intentionally bounded.

## Negative Tests

- **Malformed inputs**: alias collision, missing GitHub username, unsupported evidence source, and absent local workspace.
- **Error paths**: missing app installation/auth, GitHub request failure, and malformed git enrichment all keep source availability explicit instead of faking completeness.
- **Boundary conditions**: excluded contributors stay excluded with provenance, and retained contributors always emit at least one machine-readable provenance record.

## Steps

1. Write failing refresh tests with stubbed Octokit/local-git inputs covering happy-path collection, alias collision, missing GitHub access, and missing local workspace behavior.
2. Implement `src/contributor/xbmc-fixture-refresh.ts` to collect GitHub evidence, optionally enrich from `tmp/xbmc`, normalize identities through the manifest, and assemble a stable snapshot.
3. Regenerate `fixtures/contributor-calibration/xbmc-snapshot.json` from the curated manifest and keep retained/excluded sections plus provenance arrays deterministic.
4. Re-run the focused refresh tests and confirm the checked-in snapshot remains stable on repeated runs.

## Must-Haves

- [ ] The refresh module writes one stable checked-in snapshot keyed by normalized contributor identity.
- [ ] Missing GitHub or local-git sources are reported explicitly instead of silently reducing provenance.
- [ ] Exclusions remain visible with machine-readable reason codes and provenance.

## Verification

- `bun test ./src/contributor/xbmc-fixture-refresh.test.ts`
- `test -s fixtures/contributor-calibration/xbmc-snapshot.json`

## Observability Impact

- Signals added/changed: refresh result fields for retained/excluded counts, source availability, and alias-collision/provenance failures.
- How a future agent inspects this: run the refresh module through `bun run verify:m046:s01 -- --refresh --json` and compare the emitted source-availability diagnostics to the checked-in snapshot.
- Failure state exposed: GitHub auth/install failures, local-workspace absence, alias collisions, and missing provenance records.

## Inputs

- `fixtures/contributor-calibration/xbmc-manifest.json` — curated retained/excluded contributor list and alias/exclusion policy from T01.
- `src/contributor/fixture-set.ts` — fixture contract helpers and validation rules that the collector must honor.
- `src/auth/github-app.ts` — existing app-auth seam for bounded GitHub evidence collection.
- `.env` — existing local GitHub App env source; use it without echoing or restating secret values.
- `tmp/xbmc` — optional local workspace for git-based enrichment when present.

## Expected Output

- `src/contributor/xbmc-fixture-refresh.ts` — refresh module that collects GitHub/local-git evidence, normalizes identities, and assembles the deterministic snapshot.
- `src/contributor/xbmc-fixture-refresh.test.ts` — regression tests for happy-path refresh, alias collision, missing GitHub access, and missing local workspace behavior.
- `fixtures/contributor-calibration/xbmc-snapshot.json` — checked-in retained/excluded snapshot with machine-readable provenance and source-availability data.
