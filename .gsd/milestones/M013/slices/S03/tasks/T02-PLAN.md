# T02: 74-reliability-regression-gate 02

**Slice:** S03 — **Milestone:** M013

## Description

Ship a deterministic release gate that verifies issue write-mode PR-creation reliability and combined degraded retrieval behavior, and fails pre-release checks when runtime prerequisites or contracts regress.

Purpose: Phase 74 completes when maintainers can run one repeatable path that proves write-mode reliability plus degraded retrieval behavior in Azure runtime context and blocks release on regressions.
Output: New Phase 74 verification CLI, package command wiring, and runbook/smoke documentation with explicit blocking criteria for both reliability and retrieval-behavior checks.

## Must-Haves

- [ ] "Maintainers can run one deterministic automated regression scenario for issue write-mode reliability that fails non-zero on regressions"
- [ ] "The deterministic scenario combines degraded-path execution and retrieval-behavior assertions with issue write-mode publish checks in the same run"
- [ ] "Pre-release verification path includes deterministic Azure runtime capability checks for branch creation, push strategy, and PR creation permissions on xbmc/xbmc"
- [ ] "Gate output provides clear actionable failure signals tied to failed step/status rather than ambiguous environment phrasing"
- [ ] "Release gate blocks when machine-checkable write-mode reliability checks or retrieval-behavior checks fail"

## Files

- `scripts/phase74-reliability-regression-gate.ts`
- `scripts/phase74-reliability-regression-gate.test.ts`
- `package.json`
- `docs/smoke/phase74-reliability-regression-gate.md`
- `docs/runbooks/xbmc-ops.md`
