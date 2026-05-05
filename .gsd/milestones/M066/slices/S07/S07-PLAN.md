# S07: Remediate deployed formatter-suggestion mention path and live proof

**Goal:** Diagnose and fix why the deployed `@kodiai format suggestions` trigger is handled as a generic conversational request instead of the explicit formatter-suggestion subflow, then deploy and capture accepted same-PR GitHub formatter-suggestion proof that satisfies `verify:m066:s05`.
**Demo:** After this: a deployed authenticated smoke run produces a formatter `mention-format-suggestions` reviewOutputKey, a COMMENTED same-PR Kodiai Pull Request Review with at least one fenced suggestion comment, and `bun run verify:m066:s05` returns `m066_s05_ok`.

## Must-Haves

- A failing deterministic regression or captured runtime evidence identifies why the deployed `@kodiai format suggestions` path missed the formatter-suggestion intent.
- The root cause is fixed in code and covered by targeted tests.
- The fix is deployed or otherwise exercised against the same deployed path used by production webhooks.
- A controlled PR smoke produces a formatter `mention-format-suggestions` reviewOutputKey and a same-PR Kodiai Pull Request Review with at least one fenced `suggestion` block.
- `bun run verify:m066:s05 -- --repo ... --review-output-key ... --delivery-id ... --json` returns `success: true` and `status_code: "m066_s05_ok"`.
- R077 and R085 have evidence suitable for validation after the smoke proof is captured.

## Proof Level

- This slice proves: Live deployed smoke plus deterministic regression gates.

## Integration Closure

The slice is complete only when a fresh authenticated/deployed smoke run captures a formatter `mention-format-suggestions` reviewOutputKey, a same-PR COMMENTED Kodiai Pull Request Review, at least one associated fenced `suggestion` review comment, delivery/log correlation, and `bun run verify:m066:s05` returns `m066_s05_ok`. If the runtime fix cannot be deployed or GitHub rejects the suggestion batch, the slice must stay incomplete with bounded evidence.

## Verification

- Adds or verifies structured evidence for formatter mention classification, formatter subflow execution, publisher outcome, reviewOutputKey, delivery id, and verifier status so future live-smoke failures distinguish trigger classification, command execution, mapping, publisher, and GitHub acceptance failures.

## Tasks

- [x] **T01: Root-cause the deployed formatter trigger miss** `est:1 context`
  Reconstruct the failed PR #134 path from existing artifacts before changing code. Inspect `docs/smoke/m066-formatter-suggestions.md`, S06 task summaries, current mention routing tests, and relevant logs/artifacts if available. Identify the first boundary where `@kodiai format suggestions` stopped being interpreted as formatter intent: webhook event shape, mention parser input normalization, PR/issue-comment surface classification, config loading, or orchestrator dispatch. Produce a short root-cause note in the task summary with exact file/function evidence.
  - Files: `docs/smoke/m066-formatter-suggestions.md`, `src/handlers/mention.ts`, `src/handlers/formatter-suggestion-intent.ts`, `src/handlers/mention.test.ts`, `.gsd/milestones/M066/slices/S06/tasks/T03-SUMMARY.md`, `.gsd/milestones/M066/slices/S06/tasks/T04-SUMMARY.md`
  - Verify: No code-change gate yet. Verification is evidence quality: cite the exact boundary and source lines/artifacts showing why `@kodiai format suggestions` fell through to conversational handling.

- [x] **T02: Pin the live trigger miss with a failing regression** `est:1 context`
  Add the smallest deterministic regression that reproduces the PR #134 failure shape. Prefer extending `src/handlers/mention.test.ts` or `src/handlers/formatter-suggestion-intent.test.ts` with the exact event/comment shape from the smoke: top-level PR issue comment body `@kodiai format suggestions`, PR context, formatter config loaded from the PR head, and expected format-only subflow dispatch without Claude. Run the targeted test and confirm it fails before implementation, unless T01 proves the failure is deployment/config drift not represented in current code; in that case, add a regression around the discovered drift boundary.
  - Files: `src/handlers/mention.test.ts`, `src/handlers/formatter-suggestion-intent.test.ts`, `src/handlers/formatter-suggestion-orchestration.test.ts`
  - Verify: `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000` must show the new regression fails before the implementation change, then pass after T03.

- [x] **T03: Fix formatter intent routing at the source** `est:1 context`
  Implement the root-cause fix identified in T01 and proven by T02. Keep the change narrow: fix classification/routing/config propagation at the source boundary, not by adding a broad fallback in the publisher or verifier. Preserve existing invariants: format-only stays read-only and bypasses Claude; combined review+format preserves normal review routing; formatter command/output remains deterministic; no branch pushes/new PRs/bot commits are introduced. Add or adjust structured logs only if the failing boundary lacked enough signal to diagnose future misses.
  - Files: `src/handlers/mention.ts`, `src/handlers/formatter-suggestion-intent.ts`, `src/handlers/formatter-suggestion-orchestration.ts`, `src/execution/config.ts`, `src/handlers/mention.test.ts`
  - Verify: `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts`

- [x] **T04: Deploy the formatter-routing fix and capture revision proof** `est:1 context`
  Deploy or otherwise update the runtime used by GitHub webhooks with the T03 fix, then capture non-secret deployment evidence: active revision, readiness/health signal, and any deployment command output needed by existing runbooks. Do not paste secrets. If deployment is not possible in the environment, stop with a blocker and do not attempt to claim live proof from local tests.
  - Files: `docs/smoke/m066-formatter-suggestions.md`, `deploy.sh`, `docs/runbooks/formatter-suggestions.md`
  - Verify: Use the project deploy/runbook command appropriate for this repo and record active ACA revision plus `/healthz` and `/readiness` success, or record a plan-invalidating blocker if deployment access is unavailable.

- [ ] **T05: Capture accepted same-PR formatter suggestion proof** `est:1 context`
  Rerun the controlled formatter smoke against PR #134 or create a fresh controlled PR if needed. Ensure the PR head carries a formatter command when `main` does not. Post `@kodiai format suggestions`, capture the trigger comment id/url, delivery id, formatter reviewOutputKey, Kodiai Pull Request Review id/url, associated fenced suggestion review comment id/url, posted/skipped/capped/publisher status fields, active revision, and bounded logs. Update `docs/smoke/m066-formatter-suggestions.md` from bounded decline to accepted proof only if all required fields exist.
  - Files: `docs/smoke/m066-formatter-suggestions.md`, `scripts/verify-m066-s05.ts`, `scripts/verify-m066-s05.test.ts`, `.gsd/REQUIREMENTS.md`
  - Verify: `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` must return `success: true` and `status_code: "m066_s05_ok"`. Then rerun the deterministic M066 regression bundle from T03.

## Files Likely Touched

- docs/smoke/m066-formatter-suggestions.md
- src/handlers/mention.ts
- src/handlers/formatter-suggestion-intent.ts
- src/handlers/mention.test.ts
- .gsd/milestones/M066/slices/S06/tasks/T03-SUMMARY.md
- .gsd/milestones/M066/slices/S06/tasks/T04-SUMMARY.md
- src/handlers/formatter-suggestion-intent.test.ts
- src/handlers/formatter-suggestion-orchestration.test.ts
- src/handlers/formatter-suggestion-orchestration.ts
- src/execution/config.ts
- deploy.sh
- docs/runbooks/formatter-suggestions.md
- scripts/verify-m066-s05.ts
- scripts/verify-m066-s05.test.ts
- .gsd/REQUIREMENTS.md
