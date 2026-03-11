# T02: 24-enhanced-config-fields 02

**Slice:** S03 — **Milestone:** M003

## Description

Add telemetry config section with opt-out control and cost warning threshold.

Purpose: CONFIG-10 (telemetry opt-out) and CONFIG-11 (cost warning) give repo owners control over telemetry collection and cost visibility.
Output: New telemetry schema section, conditional telemetry recording in both handlers, cost warning comment logic.

## Must-Haves

- [ ] "Setting telemetry.enabled: false causes Kodiai to skip telemetry recording for that repo"
- [ ] "Setting telemetry.costWarningUsd: 2.0 causes a warning comment when execution cost exceeds $2.00"
- [ ] "When telemetry.enabled is false, cost warnings are also suppressed"
- [ ] "Default telemetry config (enabled: true, costWarningUsd: 0) preserves existing behavior with no warnings"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
