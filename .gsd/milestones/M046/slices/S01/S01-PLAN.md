# S01: xbmc Fixture Set and Provenance Collector

**Goal:** Build a checked-in xbmc contributor fixture pack with normalized identities, explicit alias/bot exclusions, curated cohort coverage, and machine-readable provenance, then expose one refresh/verify command that rebuilds and validates it for downstream calibration work.
**Demo:** Run the new xbmc fixture refresh/verification entrypoint and inspect a checked-in contributor snapshot that shows normalized contributor identities, explicit bot/alias exclusions, curated coverage across clear senior/newcomer/ambiguous-middle cases, and machine-readable provenance for every retained sample.

## Must-Haves

- Checked-in fixture artifacts separate human-curated contributor selection/exclusions from generated xbmc evidence.
- Retained contributors cover senior, newcomer, and ambiguous-middle cohorts with normalized identities and machine-readable provenance.
- Excluded bot/alias/ambiguous cases are explicit, reasoned, and never dropped silently.
- `bun run verify:m046:s01 -- --json` and `bun run verify:m046:s01 -- --refresh --json` fail on coverage, provenance, or normalization drift.
- This slice advances R047 by giving S02 a reusable xbmc corpus for live-path vs intended-model evaluation.

## Threat Surface

- **Abuse**: Bot accounts, alias collisions, or stale/partial GitHub data can poison the fixture corpus and create false confidence in later calibration results.
- **Data exposure**: Only public GitHub contributor metadata, evidence URLs, and optional local workspace paths should be persisted; never print or store app credentials or secret-bearing request data.
- **Input trust**: GitHub usernames, commit authors, review authors, manifest aliases, exclusion lists, and local `tmp/xbmc` history are all untrusted until normalized through the fixture contract.

## Requirement Impact

- **Requirements touched**: R047.
- **Re-verify**: S02 must consume this fixture pack without bypassing the manifest/snapshot/provenance contract, and its evaluator must preserve retained/excluded contributor truth.
- **Decisions revisited**: D072, D073.

## Proof Level

- This slice proves: integration.
- Real runtime required: yes.
- Human/UAT required: no.

## Verification

- `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts`
- `bun run verify:m046:s01 -- --json`
- `bun run verify:m046:s01 -- --refresh --json`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: verifier `status_code`, retained/excluded counts, cohort coverage counts, provenance completeness, alias-collision diagnostics, and source-availability fields for GitHub/local-git enrichment.
- Inspection surfaces: `fixtures/contributor-calibration/xbmc-manifest.json`, `fixtures/contributor-calibration/xbmc-snapshot.json`, and `bun run verify:m046:s01 -- --json`.
- Failure visibility: missing GitHub access, alias collisions, missing provenance fields, missing cohort coverage, or snapshot drift surface as named verifier failures.
- Redaction constraints: never print secrets or tokens; persist only public contributor identifiers, evidence URLs, and local workspace paths.

## Integration Closure

- Upstream surfaces consumed: `src/contributor/types.ts`, `src/contributor/expertise-scorer.ts`, `src/contributor/tier-calculator.ts`, `src/handlers/review.ts`, `src/auth/github-app.ts`, optional `tmp/xbmc`, and GitHub App env from `.env`.
- New wiring introduced in this slice: a checked-in xbmc fixture manifest + snapshot and one `verify:m046:s01` refresh/verify CLI.
- What remains before the milestone is truly usable end-to-end: S02 must evaluate live incremental vs intended full-signal scoring against this fixture pack, and S03 must turn that evidence into a keep/retune/replace verdict.

## Tasks

- [x] **T01: Define the xbmc fixture contract, normalization rules, and curated manifest** `est:75m`
  - Why: S02 cannot trust any calibration result unless the fixture corpus has a deterministic contract for normalized identity, cohort coverage, exclusions, and provenance.
  - Files: `src/contributor/fixture-set.ts`, `src/contributor/fixture-set.test.ts`, `fixtures/contributor-calibration/xbmc-manifest.json`, `fixtures/contributor-calibration/xbmc-snapshot.json`
  - Do: Add typed fixture records and normalization checks, write failing tests for duplicate identities/missing exclusion reasons/missing provenance placeholders, and seed a curated manifest plus snapshot scaffold that already covers senior, newcomer, and ambiguous-middle retained samples.
  - Verify: `bun test ./src/contributor/fixture-set.test.ts`
  - Done when: the manifest distinguishes retained contributors from explicit exclusions, tests fail on malformed rows, and the curated set covers the milestone demo cohorts.
- [ ] **T02: Build the live xbmc collector and checked-in snapshot writer** `est:90m`
  - Why: The milestone needs real xbmc evidence, not hand-written anecdotes, and the checked-in snapshot must stay stable across refreshes.
  - Files: `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, `src/contributor/xbmc-fixture-refresh.test.ts`, `fixtures/contributor-calibration/xbmc-manifest.json`, `fixtures/contributor-calibration/xbmc-snapshot.json`
  - Do: Implement the refresh module that reads the curated manifest, collects GitHub evidence through the existing app seam, optionally enriches from `tmp/xbmc`, normalizes aliases, and writes stable retained/excluded snapshot sections with machine-readable provenance and explicit source-availability reporting.
  - Verify: `bun test ./src/contributor/xbmc-fixture-refresh.test.ts && test -s fixtures/contributor-calibration/xbmc-snapshot.json`
  - Done when: repeated refresh runs produce a stable checked-in snapshot, exclusions remain visible with reason codes, and missing GitHub/local-git sources surface explicitly instead of silently shrinking provenance.
- [ ] **T03: Ship the xbmc refresh/verify entrypoint and proof report** `est:90m`
  - Why: Downstream slices need one durable command that refreshes and verifies the fixture pack instead of reconstructing snapshot checks ad hoc.
  - Files: `scripts/verify-m046-s01.ts`, `scripts/verify-m046-s01.test.ts`, `package.json`, `fixtures/contributor-calibration/xbmc-manifest.json`, `fixtures/contributor-calibration/xbmc-snapshot.json`
  - Do: Build a human/JSON verifier with `--refresh` support, stable check IDs/status codes, explicit non-zero failures for coverage/provenance/normalization drift, wire `verify:m046:s01` into `package.json`, and regenerate the checked-in snapshot through the shipped CLI.
  - Verify: `bun test ./scripts/verify-m046-s01.test.ts && bun run verify:m046:s01 -- --json && bun run verify:m046:s01 -- --refresh --json && bun run tsc --noEmit`
  - Done when: the shipped entrypoint refreshes and verifies the fixture pack, human and JSON output agree, and the checked-in snapshot passes through the final CLI path.

## Files Likely Touched

- `src/contributor/fixture-set.ts`
- `src/contributor/fixture-set.test.ts`
- `fixtures/contributor-calibration/xbmc-manifest.json`
- `fixtures/contributor-calibration/xbmc-snapshot.json`
- `src/contributor/xbmc-fixture-refresh.ts`
- `src/contributor/xbmc-fixture-refresh.test.ts`
- `scripts/verify-m046-s01.ts`
- `scripts/verify-m046-s01.test.ts`
- `package.json`
