# S01: Rereview trigger proof and decision

**Goal:** Prove the real rereview topology and choose the supported manual trigger contract.
**Demo:** After this slice, we have hard evidence for whether `ai-review` / `aireview` is a real Kodiai rereview path or whether the supported manual trigger must remain `@kodiai review`.

## Must-Haves

- Live/repo evidence shows whether UI rereview can actually target Kodiai.
- A decision is recorded: wire the team path end-to-end or remove it as a supported path.
- Issue #84 is updated with the decision and current operator guidance.

## Proof Level

- This slice proves: Operational proof from GitHub reviewer topology, webhook/handler evidence, and current config/doc audit.

## Integration Closure

Not provided.

## Verification

- Adds a concrete evidence trail for why a UI rereview request is accepted, skipped, or impossible, so operators are not left inferring from missing reviews.

## Tasks

- [x] **T01: Audit rereview topology and current contract** `est:1 context window`
  Inspect the current GitHub-side rereview topology and the repo-side acceptance contract. Confirm whether the configured `uiRereviewTeam` path can actually target Kodiai in practice, and compare that against the handler/config/runbook surfaces that currently claim it works.

Capture the exact external facts needed for a decision:
- current requested reviewer/team behavior
- whether Kodiai is actually reachable through the team path
- what code/config/docs currently assume
  - Files: `docs/runbooks/review-requested-debug.md`, `.kodiai.yml`, `src/handlers/review.ts`, `src/handlers/rereview-team.ts`
  - Verify: Use GitHub API/CLI evidence plus targeted code/doc inspection to show whether the UI team path can actually target Kodiai and where the repo currently claims it can.

- [x] **T02: Record supported rereview contract decision** `est:1 context window`
  Based on the audit, choose the supported manual rereview contract and record it clearly. If the team path is not actually available, make that explicit as the current unsupported path; if it is available, define the proof that must exist before the docs can keep claiming it.

Record the choice in project decision artifacts and update issue #84 with the current authoritative operator guidance.
  - Files: `.gsd/DECISIONS.md`, `.gsd/milestones/M051/M051-ROADMAP.md`
  - Verify: The chosen contract is written down with evidence, and issue #84 reflects the same supported operator guidance.

- [x] **T03: Define S02 implementation and proof scope** `est:1 context window`
  Convert the audit and decision into the implementation brief for S02. Identify exactly which code/config/docs/tests will need to change depending on the chosen direction, and define the proof points S02 must satisfy to close R055 without leaving stale trigger claims behind.
  - Files: `src/handlers/review.ts`, `src/handlers/mention.ts`, `docs/runbooks/review-requested-debug.md`, `.kodiai.yml`, `src/handlers/review.test.ts`
  - Verify: The follow-on implementation surface and proof checklist are explicit enough that S02 can execute without re-litigating the trigger contract.

## Files Likely Touched

- docs/runbooks/review-requested-debug.md
- .kodiai.yml
- src/handlers/review.ts
- src/handlers/rereview-team.ts
- .gsd/DECISIONS.md
- .gsd/milestones/M051/M051-ROADMAP.md
- src/handlers/mention.ts
- src/handlers/review.test.ts
