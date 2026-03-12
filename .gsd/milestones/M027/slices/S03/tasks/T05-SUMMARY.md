---
id: T05
parent: S03
milestone: M027
provides:
  - Repeatable S03 proof harness with stable check IDs, preserved repair/status/no-op/audit evidence, and idempotent live verification for the non-wiki repair path.
key_files:
  - scripts/verify-m027-s03.ts
  - scripts/verify-m027-s03.test.ts
  - src/knowledge/embedding-repair.ts
  - src/knowledge/embedding-repair.test.ts
  - docs/operations/embedding-integrity.md
  - .gsd/REQUIREMENTS.md
key_decisions:
  - Scope the S03 audit verdict to the repaired corpus plus the no-op probe corpus while still preserving the full audit envelope.
  - Do not overwrite an existing embedding_repair_state checkpoint on healthy no-op reruns; status should continue to expose the last bounded repair evidence.
patterns_established:
  - Slice proof harnesses stay JSON-first, keep stable check IDs, and preserve raw evidence envelopes so idempotent reruns remain machine-checkable.
observability_surfaces:
  - bun run verify:m027:s03 -- --corpus review_comments --json
  - bun run repair:embeddings -- --corpus review_comments --status --json
  - bun run audit:embeddings --json
  - embedding_repair_state
duration: 45m
verification_result: passed
completed_at: 2026-03-12T02:07:03-07:00
blocker_discovered: false
---

# T05: Add repeatable slice proof and execute live review-comment repair evidence

**Finished the S03 proof harness, verified the live non-wiki repair path end to end, and hardened healthy reruns so they no longer erase durable repair-state evidence.**

## What Happened

I completed `scripts/verify-m027-s03.ts` as the repeatable S03 proof harness. It runs four real surfaces in order:

1. `repair:embeddings -- --corpus <target> --json`
2. `repair:embeddings -- --corpus <target> --status --json`
3. `repair:embeddings -- --corpus <noop> --dry-run --json`
4. `audit:embeddings --json`

The harness preserves raw `repair_evidence`, `status_evidence`, `noop_probe_evidence`, and `audit_evidence` under stable check IDs:
- `M027-S03-REPAIR`
- `M027-S03-STATUS`
- `M027-S03-NOOP`
- `M027-S03-AUDIT`

I also tightened the underlying non-wiki repair engine after checking the durable-status behavior directly. Healthy reruns were able to overwrite the persisted `embedding_repair_state` row with a synthetic zero-count `not_needed` checkpoint, which weakens post-repair observability. I changed `src/knowledge/embedding-repair.ts` so healthy no-op reruns leave an existing checkpoint untouched, then locked that behavior in `src/knowledge/embedding-repair.test.ts`.

On the live system, the representative `review_comments` corpus is already healthy, so the final verification run is intentionally idempotent:
- `repair:embeddings -- --corpus review_comments --json` returns `repair_not_needed`
- `repair:embeddings -- --corpus review_comments --status --json` returns `repair_completed` with the durable persisted row
- `repair:embeddings -- --corpus issues --dry-run --json` returns a truthful no-op envelope
- `audit:embeddings --json` now reports all audited corpora passing, including `review_comments`

That means the slice now has both the repair contract and the repeatable proof surface. The current rerun proves the repaired state stays healthy and machine-checkable; the previously recorded live repair evidence remains documented in the runbook and requirements file.

## Verification

Passed:

- `bun test ./src/knowledge/embedding-repair.test.ts ./scripts/embedding-repair.test.ts ./scripts/verify-m027-s03.test.ts`
- `bun run repair:embeddings -- --corpus review_comments --json`
- `bun run repair:embeddings -- --corpus review_comments --status --json`
- `bun run repair:embeddings -- --corpus review_comments --resume --json`
- `bun run repair:embeddings -- --corpus issues --dry-run --json`
- `bun run verify:m027:s03 -- --corpus review_comments --json`
- `bun run audit:embeddings --json`

Key runtime results from the final verification pass:

- `verify:m027:s03` returned `overallPassed=true` and `status_code=m027_s03_ok`
- `repair_evidence.status_code=repair_not_needed` for already-healthy `review_comments`
- `status_evidence.status_code=repair_completed` for `review_comments`
- `noop_probe_evidence.status_code=repair_not_needed` for `issues`
- `audit_evidence.status_code=audit_ok` with `review_comments.missing_or_null=0`, `model_mismatch=0`

## Diagnostics

Use these first when checking future regressions:

- `bun run verify:m027:s03 -- --corpus review_comments --json` — best single-command proof surface because it preserves all four evidence envelopes together
- `bun run repair:embeddings -- --corpus review_comments --status --json` — authoritative durable status surface for the non-wiki repair state row
- `bun run audit:embeddings --json` — authoritative source for post-repair corpus health

## Deviations

- I made one unplanned observability fix while finishing the task: healthy reruns now preserve an existing `embedding_repair_state` checkpoint instead of overwriting it with a synthetic zero-count no-op row.

## Known Issues

- The current live proof reruns against an already-healthy `review_comments` corpus, so the mutating repair command is now expected to return `repair_not_needed` instead of replaying the original degraded-state repair.
- `embedding_repair_state` stores the latest durable row per `corpus + repair_key`, not a full history of all repair attempts.

## Files Created/Modified

- `scripts/verify-m027-s03.ts` — repeatable S03 proof harness with stable check IDs and preserved raw evidence envelopes.
- `scripts/verify-m027-s03.test.ts` — proof-harness contract tests for pass/fail evaluation and CLI exit behavior.
- `src/knowledge/embedding-repair.ts` — preserved durable checkpoints on healthy reruns instead of overwriting them.
- `src/knowledge/embedding-repair.test.ts` — locked the healthy-rerun checkpoint-preservation behavior.
- `docs/operations/embedding-integrity.md` — documented the S03 proof command, evidence shape, and interpretation notes.
- `.gsd/REQUIREMENTS.md` — updated proof text so S03 validation references the repeatable non-wiki proof command.
- `.gsd/DECISIONS.md` — recorded the audit-scoping and healthy-rerun checkpoint decisions.
