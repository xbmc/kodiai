# S02: Timeout-Hardened Wiki Repair Path — UAT

**Milestone:** M027
**Written:** 2026-03-12

## UAT Type

- UAT mode: mixed
- Why this mode is sufficient: S02 is an operator-facing reliability slice, so proof requires both live runtime execution against the real Postgres/Voyage path and inspection of the persisted/status artifacts that show bounded progress, resume state, and honest post-run audit evidence.

## Preconditions

- `DATABASE_URL` points at the live Postgres environment used by the knowledge stores.
- Voyage credentials are configured so wiki contextual embeddings can run.
- The representative wiki page `JSON-RPC API/v8` exists in `wiki_pages`.
- The codebase is on the S02-complete branch with `repair:wiki-embeddings` and `verify:m027:s02` available in `package.json`.

## Smoke Test

Run:

`bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`

Expected quick confirmation:
- `success=true`
- `status_code=m027_s02_ok`
- check IDs include `M027-S02-REPAIR`, `M027-S02-STATUS`, and `M027-S02-AUDIT`
- `status_evidence.run.page_title` is `JSON-RPC API/v8`

## Test Cases

### 1. Run a bounded wiki repair on the representative page

1. Execute `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json`.
2. Inspect the returned `status_code`, `target_model`, `run.status`, and `failure_summary` fields.
3. **Expected:** command succeeds with `status_code=repair_completed`, target model `voyage-context-3`, and no hidden failure summary. On a first live repair it may rewrite rows; on a rerun it may legitimately report `repaired=0` because the page is already healthy.

### 2. Inspect durable checkpoint/status state

1. Execute `bun run repair:wiki-embeddings -- --status --json`.
2. Inspect `run.page_title`, `run.window_index`, `run.windows_total`, `run.repaired`, `run.failed`, `run.retry_count`, and `run.failure_summary`.
3. **Expected:** the status surface exposes the persisted checkpoint for `JSON-RPC API/v8`, including durable cursor/count metadata (for the representative proof run: page id `13137`, `windows_total=49`, `repaired=388`, `failed=0`, `used_split_fallback=false`).

### 3. Resume without restarting from page 1

1. Execute `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json`.
2. Inspect `resumed`, `run.page_title`, and the persisted counters/cursor.
3. **Expected:** the command succeeds with `resumed=true` and completes cleanly using the stored repair state rather than restarting the workflow from the beginning.

### 4. Run the slice proof harness

1. Execute `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`.
2. Inspect `overallPassed`, `status_code`, `checks[*]`, and the preserved `repair_evidence`, `status_evidence`, and `audit_evidence` payloads.
3. **Expected:** the verifier returns `overallPassed=true`, `status_code=m027_s02_ok`, and preserves the raw evidence envelopes rather than flattening them into a single pass/fail string.

## Edge Cases

### Idempotent rerun after prior successful repair

1. Re-run `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json` after the page is already healthy.
2. **Expected:** the command still succeeds. It may report `repaired=0` and no active window cursor, while the durable status row continues to show the earlier successful bounded repair (`388` repaired over `49` windows).

### Full audit still fails outside wiki scope

1. Read `audit_evidence` from `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`.
2. **Expected:** the verifier still passes S02 even if `audit_evidence.overall_status=fail`, provided `wiki_pages` is healthy. Unrelated corpus failures must remain visible and must not be rewritten into fake success.

## Failure Signals

- `repair:wiki-embeddings` returns a non-success `status_code`, non-zero `failed`, a populated `last_failure_class`, or the wrong `target_model`.
- `--status --json` does not expose cursor/count metadata from persisted state, or shows stale/contradictory values that do not match the live proof run.
- `verify:m027:s02 --json` omits raw evidence envelopes or stable check IDs.
- `audit_evidence` shows `wiki_pages.missing_or_null > 0`, `wiki_pages.model_mismatch > 0`, or `wiki_pages.actual_models` not containing only `voyage-context-3`.
- A rerun silently treats unrelated corpus failures as success or hides them from the proof output.

## Requirements Proved By This UAT

- R020 — proves the wiki repair path is explicit, resumable, online-safe, and operator-inspectable through real commands and persisted status state.
- R022 — proves the timeout-prone wiki repair path now completes on representative live data with bounded work units, durable checkpoints, and no normal-case timeout failure.
- R024 — proves the repeatable S02 verifier preserves machine-checkable evidence and can catch future wiki repair/proof regressions.

## Not Proven By This UAT

- Milestone-wide all-corpus repair completeness; `learning_memories`, `review_comments`, `code_snippets`, `issues`, and `issue_comments` still need S03/S04 coverage.
- A fully green global embedding audit; this UAT intentionally allows unrelated corpus failures to remain visible in the preserved full audit envelope.
- Timeout hardening for any non-wiki repair path.

## Notes for Tester

Use the persisted status surface as the authoritative completion proof for reruns. Once `JSON-RPC API/v8` is healthy, repair reruns may legitimately do no additional work; that is not a failure as long as `verify:m027:s02 --json` still passes and the status checkpoint remains intact.
