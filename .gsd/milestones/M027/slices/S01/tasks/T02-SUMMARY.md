---
id: T02
parent: S01
milestone: M027
provides:
  - Read-only embedding audit logic and `audit:embeddings` operator command with stable JSON and human output
key_files:
  - src/knowledge/embedding-audit.ts
  - scripts/embedding-audit.ts
  - package.json
key_decisions:
  - M027/S01 embedding audit runs inside a Postgres read-only transaction instead of relying on convention alone
  - Human-readable audit output is rendered from the same JSON report envelope used for `--json`
patterns_established:
  - Corpus audit math is centralized in a shared builder so pure contract tests and live DB queries use the same status logic
  - CLI entrypoint returns machine-stable `success` and `status_code` fields while preserving deterministic stdout JSON for automation
observability_surfaces:
  - bun run audit:embeddings --json
  - bun run audit:embeddings
  - Stable per-corpus fields for missing embeddings, stale support, model mismatch, and snippet occurrence coverage
duration: 55m
verification_result: passed
completed_at: 2026-03-11T15:30:00-07:00
blocker_discovered: false
---

# T02: Implement the read-only embedding audit surface

**Shipped the shared embedding audit module plus the `audit:embeddings` operator command that truthfully reports six-corpus embedding health without mutating data.**

## What Happened

I added `src/knowledge/embedding-audit.ts` and implemented both the pure contract-facing report builder and the live database audit path.

The module now:

- locks the six audited corpora in a stable order
- enforces corpus-specific expected models (`wiki_pages` uses `voyage-context-3`, everything else uses `voyage-code-3`)
- reports `issues` and `issue_comments` as `stale_support: not_supported` instead of inventing stale counts from absent schema
- exposes code-snippet occurrence diagnostics via `occurrence_rows` and `snippets_without_occurrences`
- derives stable per-corpus `status`/`severity` plus top-level `overall_status`/`overall_severity`
- wraps the live SQL reads in a Postgres read-only transaction so the operator surface is structurally non-mutating
- adds `success` and `status_code` on the final envelope for machine consumers

I also added `scripts/embedding-audit.ts` and wired `package.json` with `audit:embeddings`.

The CLI now:

- supports `--json` and `--help`
- renders human output from the same shared report object used for JSON
- exits deterministically based on the audit envelope
- prints explicit operator errors instead of vague failures when the audit cannot run

On the current live database, the audit runs successfully and reports real failures rather than masking them: `review_comments` currently show null embeddings, and `wiki_pages` currently show a full model mismatch against the locked `voyage-context-3` expectation.

## Verification

Task-level verification passed:

- `bun test ./src/knowledge/embedding-audit.test.ts ./scripts/embedding-audit.test.ts`
  - 5/5 tests passed
- `bun run audit:embeddings --json`
  - command executed the live audit and emitted deterministic JSON
  - current live result surfaced `overall_status: fail`, `status_code: audit_failed`, and concrete failing corpora instead of hiding degraded state

Slice-level verification status after T02:

- `bun test ./src/knowledge/embedding-audit.test.ts ./src/knowledge/retriever-verifier.test.ts ./scripts/embedding-audit.test.ts ./scripts/retriever-verify.test.ts ./scripts/verify-m027-s01.test.ts`
  - audit tests pass
  - retriever/proof-harness tests still fail because T03/T04 files are not implemented yet
- `bun run verify:retriever --repo xbmc/xbmc --query "json-rpc subtitle delay" --json`
  - expected failure: script not found (T03 not shipped yet)
- `bun run verify:m027:s01 --repo xbmc/xbmc --query "json-rpc subtitle delay"`
  - expected failure: script not found (T04 not shipped yet)

## Diagnostics

Future agents can inspect this surface with:

- `bun run audit:embeddings --json` for the machine contract
- `bun run audit:embeddings` for the human rendering of the same data

The audit now exposes, per corpus:

- `total`
- `missing_or_null`
- `stale`
- `stale_support`
- `model_mismatch`
- `expected_model`
- `actual_models`
- `status`
- `severity`
- `occurrence_diagnostics` for `code_snippets`

Current live failures are directly inspectable from command output instead of requiring manual table spelunking.

## Deviations

- None.

## Known Issues

- The live audit currently reports real production/data-state failures in `review_comments` and `wiki_pages`; this task intentionally surfaces them and does not repair them.
- `verify:retriever` and `verify:m027:s01` remain unimplemented until T03/T04.

## Files Created/Modified

- `src/knowledge/embedding-audit.ts` — shared six-corpus audit logic, result types, read-only DB queries, report builder, and human renderer
- `scripts/embedding-audit.ts` — CLI parser, audit runner, JSON/human output selection, and stable exit behavior
- `package.json` — added the `audit:embeddings` script alias
- `.gsd/milestones/M027/slices/S01/S01-PLAN.md` — marked T02 complete
- `.gsd/DECISIONS.md` — recorded the read-only transaction and shared JSON-to-human rendering decision
- `.gsd/STATE.md` — advanced the next action to T03
