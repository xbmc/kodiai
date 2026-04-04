---
id: M036
title: "Auto Rule Generation from Feedback"
status: complete
completed_at: 2026-04-04T23:20:58.074Z
key_decisions:
  - D029 — Deduplicate generated rules by (repo, title); pending upserts must not downgrade ACTIVE or RETIRED lifecycle state — prevents sweep reproposals from accidentally regressing rules that have already been validated or retired
  - D030 — Signal score formula: positive_ratio × support, where support ramps 0→1 over minPositiveMembers → 2×minPositiveMembers — keeps sparse clusters pending while letting large clean clusters rise toward activation thresholds
  - shouldAutoActivate is a pure predicate (no I/O) separated from applyActivationPolicy orchestrator — threshold reads from env var at call time with explicit parameter override for test isolation without process.env mutation
  - Active-rules retrieval is fail-open with absolute cap of 20 rules — store errors log a warn and return empty result so reviews always proceed, prompt overload is guarded by the cap
  - Rules section placed before custom instructions so repo-specific instructions retain recency-bias position in the prompt
  - LifecycleNotifyHook is the extension point for Slack/GitHub push — fail-open catch isolation means hook failures surface as notifyHookFailed:true without throwing, and the hook is skipped when zero events
  - Retirement criteria: signal-floor (primary) and member-decay (secondary) with strict less-than boundary semantics — exactly at floor/min is kept, not retired
key_files:
  - src/db/migrations/035-generated-rules.sql
  - src/knowledge/generated-rule-store.ts
  - src/knowledge/generated-rule-proposals.ts
  - src/knowledge/generated-rule-sweep.ts
  - src/knowledge/generated-rule-activation.ts
  - src/knowledge/active-rules.ts
  - src/knowledge/generated-rule-retirement.ts
  - src/knowledge/generated-rule-notify.ts
  - src/execution/review-prompt.ts
  - src/knowledge/index.ts
  - scripts/verify-m036-s01.ts
  - scripts/verify-m036-s02.ts
  - scripts/verify-m036-s03.ts
  - package.json
lessons_learned:
  - Pure predicate + env-sourced config + fail-open orchestrator is now the established pattern across activation (S02) and retirement (S03) — mirror it exactly when adding future lifecycle policy stages
  - The LifecycleNotifyHook callback pattern (catch-isolated, skip-on-empty, notifyHookFailed field on result) is the right model for any future side-effect adapter that must never throw into the lifecycle flow
  - Non-downgrading upsert (ON CONFLICT DO UPDATE with CASE status guard) is the right approach for proposal sweep idempotency — use it any time a sweep produces candidates that may already have progressed through a lifecycle
  - hookCallCount field in verifier detail (not just hookCalled=true) is necessary to validate batch delivery received all events — important for testing combined lifecycle notification runs
  - Slack notification was deferred to an extension point (LifecycleNotifyHook) rather than implemented directly — this is acceptable for this milestone class but should be tracked as a follow-up when the feature needs to be operationally visible
---

# M036: Auto Rule Generation from Feedback

**Delivered a complete generated-rule lifecycle (proposal → activation → retirement → notification) that turns positive learning-memory clusters into durable active rules injected into the review prompt.**

## What Happened

M036 built the full loop that converts recurring positive review feedback into durable, bounded rules that shape future reviews. Three slices established the substrate (S01), wired the activation and prompt-injection path (S02), and completed the lifecycle with retirement and operator notifications (S03).

**S01 — Generated Rule Schema, Store, and Proposal Candidates:** Created the `generated_rules` PostgreSQL table (migration 035) with `pending/active/retired` lifecycle states, signal fields (`signal_score`, `member_count`, `cluster_centroid`), and five partial indexes for efficient per-status queries. The `GeneratedRuleStore` interface exposes explicit lifecycle methods with a non-downgrading upsert contract — reproposing an already-active or retired rule by the same (repo, title) key refreshes metadata without regressing its lifecycle state. `generatePendingRuleProposals` reads learning memories, clusters them by cosine similarity (reusing `cosineSimilarity` from cluster-pipeline.ts), gates clusters by size/positive-member/positive-ratio filters, selects the centroid-representative positive member as source text, sanitizes it, and computes a `positive_ratio × support` signal score. `createGeneratedRuleSweep` orchestrates this per-repo with three-boundary fail-open isolation (repo discovery, per-repo generation, per-proposal persistence).

**S02 — Rule Activation and Prompt Injection:** Built `shouldAutoActivate` (pure threshold predicate) and `applyActivationPolicy` (fail-open orchestrator) that transitions pending rules to active when signal score crosses a configurable threshold (default 0.7, overridable via `GENERATED_RULE_ACTIVATION_THRESHOLD`). Extended `src/knowledge/active-rules.ts` with `sanitizeRule`, `getActiveRulesForPrompt` (bounded retrieval with absolute 20-rule cap), and `formatActiveRulesSection` (pure markdown formatter). Wired the formatted section into `buildReviewPrompt` before custom instructions, preserving recency-bias position for repo config. Fail-open: store errors log a warn and return empty result so reviews proceed without generated rules.

**S03 — Retirement, Notification, and Lifecycle Proof:** Implemented `shouldRetireRule` (pure predicate with two criteria: signal-floor and member-decay) and `applyRetirementPolicy` (fail-open orchestrator). The notification module (`generated-rule-notify.ts`) provides `notifyLifecycleRun`, `notifyActivation`, and `notifyRetirement` — each emits structured per-event and summary logs, and optionally calls a `LifecycleNotifyHook` callback. Hook failures are catch-isolated and surface as `notifyHookFailed: true` without throwing. The lifecycle proof harness (verify-m036-s03.ts) proves all three S03 contracts: RETIREMENT, NOTIFY-LIFECYCLE, NOTIFY-FAIL-OPEN.

Total: 162 tests pass, 9 skip (DB-gated, expected), 0 fail. All three per-slice proof harnesses exit 0 with `overallPassed: true`. `bun run tsc --noEmit` exits 0.

## Success Criteria Results

## Success Criteria Results

The milestone had four integrated acceptance criteria from the context doc:

**1. Sweep produces PENDING rule candidates from high-similarity learning memory clusters** ✅
- S01 proof harness PROPOSAL-CREATED check: `bun run verify:m036:s01 -- --json` exits 0
- Evidence: `M036-S01-PROPOSAL-CREATED` passed — representative positive cluster produces persisted pending rule with sanitized title and rule text
- `generatePendingRuleProposals` correctly filters by minimum cluster size, positive member count, and positive ratio; signals score via `positive_ratio × support` formula

**2. High-confidence rule auto-activates without manual input** ✅
- S02 proof harness ACTIVATION check: `bun run verify:m036:s02 -- --json` exits 0
- Evidence: `M036-S02-ACTIVATION` passed — `ruleId=1 signalScore=0.85 threshold=0.7 activated=1`
- `shouldAutoActivate(0.85, 0.7)` returns true; `applyActivationPolicy` calls `store.activateRule` and confirms transition

**3. Active rule text appears in the review prompt custom instructions** ✅
- S02 proof harness PROMPT-INJECTION check
- Evidence: `M036-S02-PROMPT-INJECTION` passed — `sectionLength=470`, section includes `## Generated Review Rules` header, rule title, text, and signal label
- `buildReviewPrompt` extended to accept `activeRules?: SanitizedActiveRule[]` and inject formatted section before custom instructions

**4. Retirement triggers when signal drops below floor** ✅
- S03 proof harness RETIREMENT check: `bun run verify:m036:s03 -- --json` exits 0
- Evidence: `M036-S03-RETIREMENT` passed — `ruleId=1 signalScore=0.2 floor=0.3 retired=1`
- Boundary semantics confirmed: strict less-than (exactly at floor is kept, not retired)

**5. Fail-open at all stages (sweep, activation, retrieval, notification)** ✅
- S01 FAIL-OPEN: `reposProcessed=2 reposFailed=1 proposalsPersisted=1 persistFailures=1 warnCount=2` — crashing repo and persistence failure do not stop the sweep
- S02 FAIL-OPEN: store throws → `rules.length=0 warnCount=1 emptySection=true` — reviews proceed without generated rules
- S03 NOTIFY-FAIL-OPEN: hook throws → `notifyHookFailed=true` in result, warn logged, function does not throw

## Definition of Done Results

## Definition of Done

**All slices marked complete in roadmap** ✅
- S01 ✅ (Generated Rule Schema, Store, and Proposal Candidates)
- S02 ✅ (Rule Activation and Prompt Injection)
- S03 ✅ (Retirement, Notification, and Lifecycle Proof)

**All slice summaries exist** ✅
- `.gsd/milestones/M036/slices/S01/S01-SUMMARY.md` — verified exists, verification_result: passed
- `.gsd/milestones/M036/slices/S02/S02-SUMMARY.md` — verified exists, verification_result: passed
- `.gsd/milestones/M036/slices/S03/S03-SUMMARY.md` — verified exists, verification_result: passed

**Code changes exist** ✅
- `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'` shows 33+ non-.gsd files changed including migrations, src/knowledge/ modules, src/execution/review-prompt.ts, and scripts/

**All proof harnesses exit 0** ✅
- `bun run verify:m036:s01 -- --json` → exit 0, overallPassed: true, 2/2 checks pass
- `bun run verify:m036:s02 -- --json` → exit 0, overallPassed: true, 3/3 checks pass
- `bun run verify:m036:s03 -- --json` → exit 0, overallPassed: true, 3/3 checks pass

**TypeScript clean** ✅
- `bun run tsc --noEmit` exits 0 (zero errors)

**All unit tests pass** ✅
- 162 pass, 9 skip (DB-gated, expected), 0 fail across 10 test files

**Cross-slice integration** ✅
- S01 GeneratedRuleStore and types consumed by S02 activation and retrieval modules
- S02 `applyActivationPolicy` result type consumed by S03 notification module
- `buildReviewPrompt` in review-prompt.ts wired to accept active rules from S02 retrieval pipeline

## Requirement Outcomes

## Requirement Outcomes

M036 introduced entirely new scope — no prior requirements explicitly covered the generated-rule lifecycle learning loop. The context doc stated: "This is new scope — introduces a durable learning loop not previously captured in requirements."

No existing requirements transitioned status during this milestone. The following new capabilities were delivered without corresponding requirement records (per the original plan, these were introduced as new scope under M036):

- `generated_rules` table with pending/active/retired lifecycle
- Positive-cluster proposal generation from learning memories
- Auto-activation threshold policy
- Sanitized active-rule injection into review prompt
- Signal-decay retirement policy
- Fail-open notification surface with LifecycleNotifyHook callback

These capabilities are candidates for formalizing as requirements (R039+) in a future milestone if audit or compliance needs arise. No existing active requirements were advanced, validated, or invalidated by this milestone's changes.

## Deviations

The Slack notification was described in the context as "in scope" but was delivered as a LifecycleNotifyHook extension point (logging + callback) rather than a concrete Slack push integration. S03 explicitly surfaced this as a known limitation. The hook is fully wired and fail-open; a concrete Slack implementation requires a future follow-up task.

## Follow-ups

Wire `applyActivationPolicy` and `applyRetirementPolicy` into the production background sweep scheduler alongside the wiki-update-generator sweep. The `GENERATED_RULE_ACTIVATION_THRESHOLD` and `GENERATED_RULE_RETIREMENT_FLOOR` env vars are not yet in the AppConfig Zod schema — add them when hooking into the production sweep path. Implement a concrete `LifecycleNotifyHook` that posts Slack notifications on activation/retirement events — the S03 extension point is ready. The signal-score saturation ceiling (minPositiveMembers × 2) may need tuning once real production data is available. DB-gated `GeneratedRuleStore` tests (currently 9 skip) will become full integration coverage once `TEST_DATABASE_URL` is wired in CI with pgvector.
