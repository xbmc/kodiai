# S01: Slack Write Mode Enablement

**Goal:** Define and wire Slack write-intent routing so explicit prefixes and medium-confidence conversational asks can enter write mode safely, while ambiguous asks stay read-only with a deterministic retry affordance.
**Demo:** Define and wire Slack write-intent routing so explicit prefixes and medium-confidence conversational asks can enter write mode safely, while ambiguous asks stay read-only with a deterministic retry affordance.

## Must-Haves


## Tasks

- [x] **T01: 81-slack-write-mode-enablement 01** `est:4 min`
  - Define and wire Slack write-intent routing so explicit prefixes and medium-confidence conversational asks can enter write mode safely, while ambiguous asks stay read-only with a deterministic retry affordance.

Purpose: Phase 81 requires write-capable Slack routing without sacrificing deterministic safety when user intent is unclear.
Output: Intent-classification module, assistant routing integration, and tests locking prefix/conversational/ambiguous behavior.
- [x] **T02: 81-slack-write-mode-enablement 02** `est:7 min`
  - Implement the Slack write execution pipeline so clear write intents can safely produce repository changes, PR outputs, and mirrored comment links while preserving policy and permission guardrails.

Purpose: Phase 81's core outcome is enabling Slack-triggered write workflows (including PR creation and comment publication) without weakening existing deterministic write safety.
Output: Dedicated Slack write runner, runtime wiring, and tests proving policy/permission/refusal contracts plus PR/comment reporting.
- [x] **T03: 81-slack-write-mode-enablement 03** `est:5 min`
  - Add high-impact confirmation gates and complete Slack write response UX so write workflows stay safe and deterministic.

Purpose: Phase 81 needs deterministic confirmation behavior and user-facing write response contracts before operator verification gates are layered on.
Output: Confirmation-state module plus Slack response-contract wiring and tests.
- [x] **T04: 81-slack-write-mode-enablement 04** `est:1 min`
  - Add deterministic operator verification gates and runbook updates for Slack write mode so Phase 81 can be validated and release-blocking in CI/operator workflows.

Purpose: After confirmation and UX contracts are implemented, operators need stable smoke/regression checks and documentation to detect drift quickly.
Output: Phase 81 smoke/regression scripts and tests, package command aliases, and runbook updates.

## Files Likely Touched

- `src/slack/write-intent.ts`
- `src/slack/write-intent.test.ts`
- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
- `src/slack/write-runner.ts`
- `src/slack/write-runner.test.ts`
- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
- `src/index.ts`
- `src/execution/executor.ts`
- `src/execution/types.ts`
- `src/slack/write-confirmation-store.ts`
- `src/slack/write-confirmation-store.test.ts`
- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
- `scripts/phase81-slack-write-smoke.ts`
- `scripts/phase81-slack-write-smoke.test.ts`
- `scripts/phase81-slack-write-regression-gate.ts`
- `scripts/phase81-slack-write-regression-gate.test.ts`
- `package.json`
- `docs/runbooks/slack-integration.md`
