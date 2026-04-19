---
estimated_steps: 5
estimated_files: 4
skills_used: []
---

# T01: Audit rereview topology and current contract

Inspect the current GitHub-side rereview topology and the repo-side acceptance contract. Confirm whether the configured `uiRereviewTeam` path can actually target Kodiai in practice, and compare that against the handler/config/runbook surfaces that currently claim it works.

Capture the exact external facts needed for a decision:
- current requested reviewer/team behavior
- whether Kodiai is actually reachable through the team path
- what code/config/docs currently assume

## Inputs

- `GitHub issue #84`
- `Current GitHub reviewer/team topology`
- `Existing review_requested runbook and handler logic`

## Expected Output

- `.gsd milestone evidence in roadmap/slice artifacts`
- `A clear keep/remove decision input for the team rereview path`

## Verification

Use GitHub API/CLI evidence plus targeted code/doc inspection to show whether the UI team path can actually target Kodiai and where the repo currently claims it can.

## Observability Impact

Produces the concrete accepted/skipped-path evidence that future operators can reuse when debugging manual rereview.
