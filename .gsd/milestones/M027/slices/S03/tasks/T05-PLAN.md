---
estimated_steps: 4
estimated_files: 4
---

# T05: Add repeatable slice proof and execute live review-comment repair evidence

**Slice:** S03 — Unified Online Repair for Remaining Corpora
**Milestone:** M027

## Description

Finish S03 with a repeatable proof harness that preserves raw repair/status/audit evidence, then run it against the live `review_comments` degradation while also proving the shared contract behaves truthfully for a currently empty or healthy remaining corpus.

## Steps

1. Create `scripts/verify-m027-s03.ts` so it runs live `review_comments` repair, persisted status inspection, and post-run audit checks, then emits stable check IDs and preserved evidence envelopes.
2. Add `scripts/verify-m027-s03.test.ts` to lock the proof report shape, failure-state reporting, and no-op corpus evidence handling.
3. Execute the live proof command plus the underlying repair/status commands, capturing evidence that `review_comments` repair completes with durable state and that at least one other corpus reports a safe no-op/healthy status through the same CLI.
4. Update `docs/operations/embedding-integrity.md` and `.gsd/REQUIREMENTS.md` with the repeatable proof command and the honest requirement status advanced/validated by the live run.

## Must-Haves

- [ ] Proof output preserves raw `repair_evidence`, `status_evidence`, and `audit_evidence` instead of collapsing them into a single verdict string.
- [ ] Live verification proves `review_comments` repair through the real database/provider path and checks durable status output after the run.
- [ ] At least one currently empty or healthy remaining corpus is exercised through the shared CLI so S03 proves the cross-corpus operator contract, not just the degraded corpus happy path.

## Verification

- `bun test scripts/verify-m027-s03.test.ts`
- `bun run verify:m027:s03 -- --corpus review_comments --json`
- `bun run audit:embeddings --json`

## Observability Impact

- Signals added/changed: Stable S03 check IDs plus preserved repair/status/audit evidence for repeatable machine verification.
- How a future agent inspects this: Run `verify:m027:s03 --json` first, then drill into `repair:embeddings -- --status --corpus <name> --json` and `audit:embeddings --json`.
- Failure state exposed: Proof failures retain the exact failing check IDs, corpus names, and underlying evidence payloads needed to localize which repair boundary regressed.

## Inputs

- `scripts/embedding-repair.ts` — operator repair/status command from T04.
- S01/S02 proof-harness pattern — preserve raw evidence and stable check IDs rather than summary-only success/failure output.

## Expected Output

- `scripts/verify-m027-s03.ts` — repeatable slice proof harness for non-wiki repair.
- `docs/operations/embedding-integrity.md` / `.gsd/REQUIREMENTS.md` — updated with the S03 proof command and honest requirement progress grounded in live evidence.
