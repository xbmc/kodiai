---
estimated_steps: 4
estimated_files: 5
---

# T04: Close milestone evidence from the passing final proof

**Slice:** S04 — Final Integrated Production Repair Proof
**Milestone:** M027

## Description

Once the live final proof passes, update the durable project artifacts so M027 is closed by exact evidence rather than oral history. This task turns the passing command output into lasting roadmap, requirement, summary, and state updates that a future agent can trust without replaying the entire milestone.

## Steps

1. Update `.gsd/REQUIREMENTS.md` with the S04 validation evidence for the requirements this slice supports, using the exact final-proof command and its meaning.
2. Mark S04 complete in `.gsd/milestones/M027/M027-ROADMAP.md` and write `.gsd/milestones/M027/slices/S04/S04-SUMMARY.md` with the final proof results, remaining boundary notes, and authoritative diagnostics.
3. Refresh `.gsd/PROJECT.md` and `.gsd/STATE.md` so the current project state reflects that M027 reached final integrated acceptance and that `issue_comments` remains an intentional audited-only retriever boundary.
4. Cross-check that all closure artifacts point at the same passing command and do not imply more than the proof actually established.

## Must-Haves

- [ ] The milestone is marked complete only from passing live S04 evidence, not from inferred readiness.
- [ ] Closure artifacts preserve the real system boundary that six corpora are audited while `issue_comments` remains outside the retriever.

## Verification

- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`
- Read back the updated `.gsd/` artifacts and confirm they cite the same passing proof and boundary notes consistently.

## Observability Impact

- Signals added/changed: Promotes the final proof command and authoritative diagnostics into durable planning/state artifacts.
- How a future agent inspects this: Read `.gsd/milestones/M027/slices/S04/S04-SUMMARY.md`, `.gsd/REQUIREMENTS.md`, and `.gsd/STATE.md` to understand current health and exact verification commands.
- Failure state exposed: If the milestone regresses later, future agents have a single known-good proof command and prior acceptance baseline to compare against.

## Inputs

- `.gsd/milestones/M027/slices/S04/S04-PLAN.md` — defines the planned proof level, must-haves, and verification commands.
- Passing `verify:m027:s04` output from T03 — the evidence source for truthful closure updates.

## Expected Output

- `.gsd/milestones/M027/slices/S04/S04-SUMMARY.md` — durable summary of the final integrated production proof.
- `.gsd/REQUIREMENTS.md`, `.gsd/milestones/M027/M027-ROADMAP.md`, `.gsd/PROJECT.md`, `.gsd/STATE.md` — consistent milestone-closure artifacts keyed to the passing S04 proof.
