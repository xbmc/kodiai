# S02: Live proof and auditability verification

**Goal:** Add a live verifier for explicit clean `@kodiai review` approvals that proves one GitHub-visible `APPROVED` review carries the shared evidence-backed body and still correlates cleanly to Azure audit signals via the same `reviewOutputKey`.
**Demo:** Operators inspecting a clean approval on GitHub can see why it was approved without a separate issue comment, and audit tooling can correlate the same published body to the delivery cleanly.

## Must-Haves

- Introduce a dedicated `reviewOutputKey` artifact collector + body contract validator that counts matches across reviews, issue comments, and review comments instead of sampling only the latest PR artifact.
- Add `verify:m049:s02` to reject non-explicit keys, prove the sole visible artifact is one `APPROVED` review with the shared `Decision: APPROVE` / `Issues: none` / `Evidence:` body, and emit the review URL plus stable status codes.
- Reuse Azure explicit-lane evidence to confirm the same `reviewOutputKey` resolves to a clean explicit publish path (`approval-bridge`, `idempotency-skip`, or `duplicate-suppressed`) and degrade truthfully when GitHub or Azure access is unavailable.

## Threat Surface

- **Abuse**: A stale or attacker-supplied `reviewOutputKey` could otherwise make the verifier scan the wrong PR or claim success from the wrong GitHub surface; the command must parse the key, restrict the GitHub scan to the encoded PR/repo, and reject non-`mention-review` keys before live access.
- **Data exposure**: The report may expose GitHub review bodies, review URLs, delivery ids, and Azure `publishResolution` metadata, but it must never print GitHub App credentials, Azure tokens, or unrelated log rows.
- **Input trust**: CLI `--review-output-key`, GitHub API bodies/states/URLs, and Azure Log Analytics rows are untrusted inputs until the verifier validates the marker, repo/PR/action identity, review state, and matching delivery id.

## Requirement Impact

- **Requirements touched**: R043 — explicit `@kodiai review` requests must still publish exactly one visible GitHub outcome.
- **Re-verify**: one explicit clean approval yields `0` matching issue comments, `0` matching review comments, and `1` matching `APPROVED` review with the shared visible body; Azure audit correlation still resolves the same `reviewOutputKey` to a clean explicit publish resolution.
- **Decisions revisited**: D098, D116, D117.

## Proof Level

- This slice proves: operational.
- Real runtime required: yes.
- Human/UAT required: no.

## Verification

- `bun test ./src/review-audit/review-output-artifacts.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m049-s02.test.ts`
- `bun run tsc --noEmit`
- `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <key> --json`

## Observability / Diagnostics

- Runtime signals: verifier JSON/human output must include `status_code`, per-surface `artifactCounts`, `artifact.sourceUrl`, `artifact.reviewState`, body-contract booleans, Azure `publishResolution`, and `issues[]`.
- Inspection surfaces: `bun run verify:m049:s02 -- --json`, focused helper/verifier tests, and the returned GitHub review URL for operator spot-checks.
- Failure visibility: GitHub access state, Azure access state, duplicate/missing artifact counts, wrong surface/state, body drift, and audit mismatch each resolve to named non-success statuses.
- Redaction constraints: never print GitHub App private key, installation token, Azure credentials, or unrelated log rows; only report review URLs, matched audit fields, and non-secret identity metadata.

## Integration Closure

- Upstream surfaces consumed: `src/handlers/review-idempotency.ts`, `src/review-audit/evidence-correlation.ts`, `src/review-audit/log-analytics.ts`, and the GitHub App live-access pattern in `scripts/verify-m044-s01.ts`.
- New wiring introduced in this slice: a read-only live verifier joins exact GitHub artifact counting/body validation to explicit Azure publish-resolution evidence for one `mention-review` `reviewOutputKey`.
- What remains before the milestone is truly usable end-to-end: run `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <key> --json` against a fresh explicit clean approval and record the resulting proof in the slice summary.

## Tasks

- [x] **T01: Add exact review-output artifact proof helpers** `est:90m`
  - Why: `recent-review-sample.ts` intentionally keeps only the newest marker-backed artifact per PR, so S02 needs a separate exact-match helper before it can prove “exactly one visible outcome” for R043.
  - Files: `src/review-audit/review-output-artifacts.ts`, `src/review-audit/review-output-artifacts.test.ts`
  - Do: Add a PR-scoped collector that preserves every marker-matched review, issue comment, and review comment for one `reviewOutputKey`, and pair it with a pure validator for the shared visible APPROVE body, review state, and duplicate-surface failure cases.
  - Verify: `bun test ./src/review-audit/review-output-artifacts.test.ts`
  - Done when: Focused helper tests prove exact per-surface counts, preserved artifact metadata, shared-body validation, and deterministic failures for duplicate, wrong-surface, or wrong-state matches.

- [x] **T02: Build the live M049/S02 verifier command** `est:2h`
  - Why: The milestone demo is only operationally true when a read-only command can prove a real explicit clean approval still publishes one visible GitHub review body and correlates that same body to Azure audit evidence.
  - Files: `scripts/verify-m049-s02.ts`, `scripts/verify-m049-s02.test.ts`, `package.json`
  - Do: Implement `verify:m049:s02` around the new GitHub helper, reuse the existing GitHub App and Azure log query patterns, reject non-explicit keys, emit review URL/body-contract/audit fields, and map all access or correlation failures to stable named statuses.
  - Verify: `bun test ./scripts/verify-m049-s02.test.ts ./src/review-audit/evidence-correlation.test.ts && bun run tsc --noEmit`
  - Done when: The verifier command exists in `package.json`, tests pin the success/failure report contract, and the command is ready for a fresh live run with a real explicit clean `reviewOutputKey`.

## Files Likely Touched

- `src/review-audit/review-output-artifacts.ts`
- `src/review-audit/review-output-artifacts.test.ts`
- `scripts/verify-m049-s02.ts`
- `scripts/verify-m049-s02.test.ts`
- `package.json`
