# S03: Explicit Calibration Verdict and M047 Change Contract

**Goal:** Ship one milestone-closeout proof surface that composes the existing xbmc fixture and calibration verifiers into an explicit keep/retune/replace verdict plus a structured M047 keep/change/replace contract, without changing live contributor-scoring behavior.
**Demo:** Run `bun run verify:m046 -- --json` and receive one integrated report that preserves the S01 fixture evidence and S02 calibration evidence, states the explicit keep/retune/replace verdict, and emits a concrete `m047ChangeContract` naming what Kodiai must keep, change, or replace next.

## Must-Haves

- Add a canonical `verify:m046` command that preserves nested S01 fixture evidence and nested S02 calibration evidence in one integrated report.
- Separate proof-harness success from the underlying `keep` / `retune` / `replace` verdict so the current truthful `replace` outcome still exits 0.
- Emit a structured `m047ChangeContract` block naming which mechanisms to keep, change, or replace, with evidence and impacted surfaces rooted in current runtime code.
- Keep human-readable output and `--json` output derived from the same report object with stable top-level check IDs and status codes.
- Prove the integrated surface with `scripts/verify-m046.test.ts`, the shipped `verify:m046` command, the existing S01/S02 verifiers, and `bun run tsc --noEmit`.

## Threat Surface

- **Abuse**: A malformed composition layer could falsely certify the current contributor-tier mechanism by flattening S01/S02 failures into a passing verdict, re-running S01 inconsistently, or silently dropping replace-worthy runtime seams from the M047 contract.
- **Data exposure**: Output must stay limited to checked-in public contributor identifiers, verifier diagnostics, and runtime file-path evidence. Do not print secrets, token-bearing env vars, or private GitHub/App data.
- **Input trust**: The nested S01/S02 reports, checked-in snapshot identities, and any top-level keep/change/replace conclusions are untrusted until the integrated verifier validates report shape, retained/excluded counts, recommendation presence, and contract consistency.

## Requirement Impact

- **Requirements touched**: R047.
- **Re-verify**: `bun test ./scripts/verify-m046.test.ts`, the existing S01/S02 verifier tests, `bun run verify:m046`, `bun run verify:m046 -- --json`, and `bun run tsc --noEmit` must all agree on the final verdict surface and M047 contract.
- **Decisions revisited**: D074, D080, D081.

## Proof Level

- This slice proves: final-assembly.
- Real runtime required: no.
- Human/UAT required: no.

## Verification

- `bun test ./scripts/verify-m046.test.ts`
- `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts`
- `bun run verify:m046`
- `bun run verify:m046 -- --json`
- `bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: top-level `verdict`, `m047ChangeContract`, nested `fixture` and `calibration` summaries, and stable top-level check IDs/status codes.
- Inspection surfaces: `bun run verify:m046`, `bun run verify:m046 -- --json`, and `scripts/verify-m046.test.ts`.
- Failure visibility: malformed nested reports, retained/excluded drift, missing recommendation, and contradictory contract state fail with named status codes instead of ambiguous prose.
- Redaction constraints: keep output limited to checked-in public contributor identifiers, runtime file paths, and verifier diagnostics; never echo secrets or token-bearing env.

## Integration Closure

- Upstream surfaces consumed: `scripts/verify-m046-s01.ts`, `scripts/verify-m046-s02.ts`, `src/handlers/review.ts`, `src/slack/slash-command-handler.ts`, `src/contributor/experience-contract.ts`, and `package.json`.
- New wiring introduced in this slice: `src/contributor/calibration-change-contract.ts`, `scripts/verify-m046.ts`, `scripts/verify-m046.test.ts`, and the `verify:m046` package entrypoint.
- What remains before the milestone is truly usable end-to-end: nothing inside M046; M047 should consume the emitted keep/change/replace contract to implement the redesign.

## Tasks

- [x] **T01: Extract the structured M047 calibration change contract** `est:75m`
  - Why: M047 needs a machine-readable keep/change/replace contract instead of prose, and the milestone verifier should derive that contract from one pure seam instead of hard-coding report text.
  - Files: `src/contributor/calibration-change-contract.ts`, `src/contributor/calibration-change-contract.test.ts`, `src/contributor/index.ts`, `scripts/verify-m046-s02.ts`, `src/handlers/review.ts`, `src/slack/slash-command-handler.ts`, `src/contributor/experience-contract.ts`
  - Do: Add a pure helper that converts the S02 recommendation plus current runtime seams into stable keep/change/replace entries with verdict, rationale, evidence strings, and impacted surfaces; export it from `src/contributor/index.ts`; and cover it with focused tests that pin the current `replace` inventory without touching the CLI.
  - Verify: `bun test ./src/contributor/calibration-change-contract.test.ts`
  - Done when: A reusable typed contract helper returns the current `replace` verdict with explicit keep/change/replace buckets, and focused unit tests prove the contract stays aligned with the live runtime surfaces M047 must address.

- [ ] **T02: Ship the integrated verify:m046 proof harness** `est:90m`
  - Why: The slice only closes when operators can run one command that composes S01 and S02 into a truthful milestone-level verdict plus the concrete M047 change contract.
  - Files: `scripts/verify-m046.ts`, `scripts/verify-m046.test.ts`, `package.json`, `scripts/verify-m046-s01.ts`, `scripts/verify-m046-s02.ts`, `src/contributor/calibration-change-contract.ts`
  - Do: Add `scripts/verify-m046.ts` and `scripts/verify-m046.test.ts`, evaluate S01 once, feed that exact report into S02 via the existing injection seam, preserve both nested reports intact, derive `m047ChangeContract`, add stable top-level consistency checks and status codes, render human and JSON output from one report object, and wire `verify:m046` in `package.json`.
  - Verify: `bun test ./scripts/verify-m046.test.ts && bun run verify:m046 && bun run verify:m046 -- --json && bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts && bun run verify:m046:s01 -- --json && bun run verify:m046:s02 -- --json && bun run verify:m046 -- --json && bun run tsc --noEmit`
  - Done when: `bun run verify:m046` and `bun run verify:m046 -- --json` report the current truthful `replace` verdict plus the structured change contract, while malformed nested reports, count drift, missing recommendation, or contradictory contract state fail with named status codes.

## Files Likely Touched

- `src/contributor/calibration-change-contract.ts`
- `src/contributor/calibration-change-contract.test.ts`
- `src/contributor/index.ts`
- `scripts/verify-m046.ts`
- `scripts/verify-m046.test.ts`
- `scripts/verify-m046-s01.ts`
- `scripts/verify-m046-s02.ts`
- `package.json`
