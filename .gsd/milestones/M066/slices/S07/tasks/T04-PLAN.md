---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T04: Deploy the formatter-routing fix and capture revision proof

Deploy or otherwise update the runtime used by GitHub webhooks with the T03 fix, then capture non-secret deployment evidence: active revision, readiness/health signal, and any deployment command output needed by existing runbooks. Do not paste secrets. If deployment is not possible in the environment, stop with a blocker and do not attempt to claim live proof from local tests.

## Inputs

- `T03 passing regression gate`
- `Existing deploy/runbook docs`

## Expected Output

- `Deployed revision evidence recorded in smoke artifact or task summary`
- `Health/readiness proof for the active revision`

## Verification

Use the project deploy/runbook command appropriate for this repo and record active ACA revision plus `/healthz` and `/readiness` success, or record a plan-invalidating blocker if deployment access is unavailable.

## Observability Impact

Anchors later GitHub smoke evidence to the exact revision containing the formatter-routing fix.
