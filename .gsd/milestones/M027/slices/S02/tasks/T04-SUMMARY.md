---
id: T04
parent: S02
milestone: M027
provides:
  - Repeatable S02 proof harness output that preserves raw repair, checkpoint/status, and audit evidence for representative live wiki repair runs.
key_files:
  - scripts/verify-m027-s02.ts
  - scripts/verify-m027-s02.test.ts
  - docs/operations/embedding-integrity.md
  - .gsd/REQUIREMENTS.md
  - src/knowledge/embeddings.ts
  - src/knowledge/wiki-embedding-repair.ts
key_decisions:
  - S02 proof verdicts evaluate wiki-only audit success from the preserved full audit envelope so unrelated corpus failures stay visible but do not invalidate the wiki repair proof.
  - Voyage contextualized chunk embeddings must call `POST /v1/contextualizedembeddings`; the live proof surfaced and corrected the stale hyphenated endpoint.
patterns_established:
  - Proof harnesses should emit stable check IDs plus the raw underlying operator/audit payloads instead of collapsing everything into one pass/fail string.
  - Representative live proof can be idempotent: re-runs may repair zero additional rows while durable checkpoint evidence still proves the prior bounded repair completed.
observability_surfaces:
  - `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`
  - `bun run repair:wiki-embeddings -- --status --json`
  - `wiki_embedding_repair_state`
  - `bun run audit:embeddings --json`
duration: ~1h20m
verification_result: passed
completed_at: 2026-03-12T00:33:30-07:00
blocker_discovered: false
---

# T04: Add repeatable slice proof and execute representative live repair evidence

**Added the S02 proof harness, executed a representative live wiki repair against `JSON-RPC API/v8`, and documented the honest requirement/proof boundaries.**

## What Happened

Added `scripts/verify-m027-s02.ts` as the repeatable slice proof command and wired it into `package.json` as `verify:m027:s02`. The harness runs three real surfaces in sequence — bounded wiki repair, persisted repair status, and the full embedding audit — then emits stable check IDs (`M027-S02-REPAIR`, `M027-S02-STATUS`, `M027-S02-AUDIT`) plus preserved raw evidence payloads (`repair_evidence`, `status_evidence`, `audit_evidence`).

The proof semantics stay honest: the audit check is scoped to `wiki_pages` inside the preserved full audit envelope, so unrelated corpus failures still remain visible in `audit_evidence` instead of being hidden or rewritten into a synthetic all-green result. That satisfies the slice contract without overstating what S02 proves.

During live proof execution, the representative repair flow exposed two real runtime defects that the earlier contract tests did not catch:
- the Voyage contextualized embedding endpoint was wired to `/v1/contextualized-embeddings` instead of the documented `/v1/contextualizedembeddings`
- batched repair writes passed `chunk_id` fields into the store path that expects `chunkId`, causing a runtime undefined-value failure during live writes

Fixed both runtime defects, then ingested the researched outlier page `JSON-RPC API/v8` into the live wiki table and ran the bounded repair path against it. The representative live repair completed successfully with `voyage-context-3` writes over 388 chunks across 49 bounded windows, with no timeout-class failure and durable checkpoint evidence persisted in `wiki_embedding_repair_state`.

Updated `docs/operations/embedding-integrity.md` with the new proof command, check IDs, interpretation notes, and representative-run guidance. Updated `.gsd/REQUIREMENTS.md` so R020/R022/R024 now reflect what S02 truly proves today: wiki repair is operationally proven and regression-guarded, but non-wiki repair coverage still belongs to later slices.

## Verification

Passed:
- `bun test ./scripts/verify-m027-s02.test.ts`
- `bun test ./src/knowledge/wiki-embedding-repair.test.ts ./scripts/wiki-embedding-repair.test.ts ./scripts/verify-m027-s02.test.ts`
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json`
  - representative live repair completed successfully
  - final live run rewrote `388` wiki chunks over `49` bounded windows
  - `status_code=repair_completed`, `failed=0`, `used_split_fallback=false`
- `bun run repair:wiki-embeddings -- --status --json`
  - persisted status surface shows durable checkpoint/progress for `JSON-RPC API/v8`
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json`
  - resume path completes cleanly on already-repaired state
- `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`
  - returns `status_code=m027_s02_ok`
  - preserves raw `repair_evidence`, `status_evidence`, and `audit_evidence`
  - shows wiki audit pass while still preserving unrelated corpus failures in the full audit envelope

Notable live evidence from the successful proof run:
- target page: `JSON-RPC API/v8`
- page id: `13137`
- repaired chunks: `388`
- windows total: `49`
- target model: `voyage-context-3`
- timeout-class failure observed in representative run: none

## Diagnostics

Primary recheck command:
- `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json`

Useful follow-ups:
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json`
- `bun run repair:wiki-embeddings -- --status --json`
- `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json`
- `bun run audit:embeddings --json`

What future agents should inspect:
- `check_ids` / `checks[*].status_code` for machine verdicts
- `status_evidence.run.page_title`, `window_index`, `windows_total`, `repaired`, `updated_at` for durable checkpoint proof
- `repair_evidence` for the immediate repair invocation result
- `audit_evidence.corpora[]` to confirm the wiki corpus passed and to see any unrelated remaining corpus failures without losing transparency

## Deviations

None.

## Known Issues

- The S02 proof is intentionally wiki-scoped. The preserved full audit envelope still shows unrelated `review_comments` degradation in this environment, so milestone-wide all-corpus repair validation remains later-slice work.
- `repair:wiki-embeddings -- --resume --json` can finish on already-healthy state with `windows_total: null`; the command still succeeds, but the durable proof surface is the persisted status checkpoint rather than the idempotent follow-up repair report.

## Files Created/Modified

- `scripts/verify-m027-s02.ts` — new S02 proof harness with stable check IDs, raw evidence preservation, and CLI entrypoint
- `package.json` — added the `verify:m027:s02` script alias
- `docs/operations/embedding-integrity.md` — documented the S02 proof command, check IDs, evidence fields, and representative-run interpretation guidance
- `.gsd/REQUIREMENTS.md` — updated R020/R022/R024 to reflect the honest post-S02 validation state
- `src/knowledge/embeddings.ts` — corrected the Voyage contextualized embeddings endpoint used by the live wiki repair path
- `src/knowledge/wiki-embedding-repair.ts` — fixed batch-write payload normalization so live repair writes succeed
- `.gsd/DECISIONS.md` — recorded the proof-harness scoping decision and the corrected Voyage endpoint
