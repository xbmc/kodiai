# S03: Unified Online Repair for Remaining Corpora — UAT

**Milestone:** M027
**Written:** 2026-03-12

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: S03 is an operator-facing runtime slice, so proof requires both live command execution against the real Postgres/Voyage wiring and inspection of durable status/audit artifacts that prove the non-wiki repair contract stays truthful across mutating, status, resume, and no-op paths.

## Preconditions

- `DATABASE_URL` points at the live Postgres knowledge database.
- Voyage credentials are configured for non-wiki embedding generation.
- The branch includes `repair:embeddings` and `verify:m027:s03` in `package.json`.
- `review_comments` data exists in Postgres; other non-wiki corpora may be empty or already healthy.

## Smoke Test

Run:

`bun run verify:m027:s03 -- --corpus review_comments --json`

Expected quick confirmation:
- `success=true`
- `status_code=m027_s03_ok`
- check IDs include `M027-S03-REPAIR`, `M027-S03-STATUS`, `M027-S03-NOOP`, and `M027-S03-AUDIT`
- `audit_evidence` includes both `review_comments` and the no-op probe corpus with passing health

## Test Cases

### 1. Run the shared repair command on the representative live corpus

1. Execute `bun run repair:embeddings -- --corpus review_comments --json`.
2. Inspect `status_code`, `target_model`, `run.status`, `run.failure_summary`, and `dry_run`.
3. **Expected:** command succeeds against the real runtime path. On a first repair it may return `repair_completed`; on a later rerun it may legitimately return `repair_not_needed` once `review_comments` is already healthy.

### 2. Inspect durable non-wiki repair status

1. Execute `bun run repair:embeddings -- --corpus review_comments --status --json`.
2. Inspect `run.run_id`, `run.status`, `run.last_row_id`, `processed`, `repaired`, `failed`, and `failure_summary`.
3. **Expected:** status is machine-readable and DB-backed. It should expose the durable `embedding_repair_state` surface instead of requiring another mutating run.

### 3. Resume without breaking healthy state

1. Execute `bun run repair:embeddings -- --corpus review_comments --resume --json`.
2. Inspect `resumed`, `status_code`, and `run.failure_summary`.
3. **Expected:** command succeeds with `resumed=true`. If the corpus is already healthy, it should still return a truthful no-op result rather than fabricating additional work.

### 4. Probe another corpus through the shared no-op path

1. Execute `bun run repair:embeddings -- --corpus issues --dry-run --json`.
2. Inspect `dry_run`, `status_code`, `processed`, `repaired`, and `failed`.
3. **Expected:** a healthy or empty remaining corpus reports a safe no-op envelope (`repair_not_needed`) through the same CLI contract used for live repair.

### 5. Run the slice proof harness

1. Execute `bun run verify:m027:s03 -- --corpus review_comments --json`.
2. Inspect `overallPassed`, `status_code`, `checks[*]`, `repair_evidence`, `status_evidence`, `noop_probe_evidence`, and `audit_evidence`.
3. **Expected:** the verifier returns `overallPassed=true`, `status_code=m027_s03_ok`, and preserves the raw evidence envelopes instead of collapsing them into a single pass/fail string.

### 6. Confirm post-repair audit health

1. Execute `bun run audit:embeddings --json`.
2. Inspect the `review_comments`, `issues`, and `issue_comments` corpus entries.
3. **Expected:** `review_comments` reports `missing_or_null=0`, `model_mismatch=0`, expected model `voyage-code-3`, and overall audit status remains truthful for all corpora.

## Edge Cases

### Idempotent rerun after the representative corpus is already healthy

1. Re-run `bun run repair:embeddings -- --corpus review_comments --json` after the repair has already completed.
2. **Expected:** the command may correctly return `repair_not_needed`. This is not a failure if `verify:m027:s03 --json` still passes and `audit:embeddings --json` still reports `review_comments` healthy.

### Healthy reruns should not erase durable proof state

1. Run `bun run repair:embeddings -- --corpus review_comments --json` on already-healthy state.
2. Then run `bun run repair:embeddings -- --corpus review_comments --status --json`.
3. **Expected:** the status surface remains authoritative and does not depend on transient stdout from the no-op rerun. Future no-op runs must not weaken durable checkpoint inspection.

## Failure Signals

- `repair:embeddings` returns non-success, non-zero `failed`, or a populated `last_failure_class` for a supposedly healthy rerun.
- `--status --json` does not expose a durable machine-readable `run` surface with cursor/count/failure metadata.
- `verify:m027:s03 --json` omits raw evidence envelopes or stable check IDs.
- `audit:embeddings --json` reports `review_comments.missing_or_null > 0`, `model_mismatch > 0`, or the wrong expected model.
- A no-op probe corpus reports degraded work unexpectedly or the proof harness hides which check failed.

## Requirements Proved By This UAT

- R020 — proves operators can use one resumable non-wiki repair contract across the remaining corpora, with real repair/status/resume/no-op execution surfaces.
- R022 — proves the representative non-wiki repair path now runs through bounded, observable, resumable commands without normal-case timeout failure.
- R024 — proves the repeatable S03 verifier preserves machine-checkable evidence and can catch future repair/status/no-op/audit regressions.

## Not Proven By This UAT

- R021 retriever correctness; that remains S01/S04 territory.
- Historical run forensics across multiple repair attempts; `embedding_repair_state` is latest-state inspection, not an append-only run log.
- Milestone-level final integrated acceptance across both wiki and non-wiki repair families plus the live retriever in one run; that remains S04.

## Notes for Tester

If `review_comments` is already healthy, treat `repair_not_needed` as the correct result. In that situation the proof burden shifts to the durable status surface and the post-run audit, not to forcing another rewrite of already-correct embeddings.
