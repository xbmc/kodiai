---
id: M044
title: "Audit Recent XBMC Review Correctness"
status: complete
completed_at: 2026-04-09T08:40:51.873Z
key_decisions:
  - D056 — lane-stratified recent-sample rule
  - D057 — single operator CLI direction for the audit surface
  - D058 — shared `reviewOutputKey` parser/normalizer
  - D059 — explicit reviews without publish-resolution proof remain `indeterminate` until evidence exists
  - D060 — use Azure Log Analytics as the first evidence repair path
  - D061 — final operator entrypoint is `verify:m044`
key_files:
  - src/handlers/review-idempotency.ts
  - src/review-audit/recent-review-sample.ts
  - src/review-audit/evidence-correlation.ts
  - src/review-audit/log-analytics.ts
  - scripts/verify-m044-s01.ts
  - scripts/verify-m044-s01.test.ts
  - docs/runbooks/recent-review-audit.md
  - package.json
  - .gsd/KNOWLEDGE.md
lessons_learned:
  - Recent review audits must parse both `kodiai:review-output-key` and `kodiai:review-details` markers or they silently miss valid clean automatic reviews.
  - When DB-backed evidence is unreachable but Azure publication logs are available, the audit should fail open on DB and classify from Azure rather than abandoning the sample.
  - The right first fix was not speculative review-logic surgery; it was consuming the publication signals the system already emits.
---

# M044: Audit Recent XBMC Review Correctness

**M044 shipped a repeatable recent xbmc/xbmc review audit that classifies real Kodiai review outcomes from GitHub-visible artifacts plus Azure publication evidence.**

## What Happened

M044 closed the ambiguity around the recent xbmc/xbmc Kodiai review stream. The milestone first built a deterministic recent-sample collector and the shared identity/correlation seams needed to reason about real GitHub-visible review artifacts. The first live audit then exposed the actual gap: GitHub sampling worked, but internal proof was incomplete in the current environment because PostgreSQL timed out and explicit mention-review publish truth was still effectively log-only. Instead of guessing from approvals alone or inventing a new persistence layer immediately, the next slice wired the Azure publication signals already emitted by the system into the audit. Automatic reviews now classify from `Evidence bundle` outcomes like `submitted-approval` and `published-output`, while explicit reviews classify from `publishResolution` on `Mention execution completed`. The final slice packaged that repaired path into the operator-facing `verify:m044` command and a dedicated runbook. The final live run over the recent xbmc/xbmc sample produced a deterministic 12-PR report with 11 `clean-valid`, 1 `findings-published`, and 0 `indeterminate`, proving that the recent stream is no longer a GitHub-only guesswork problem.

## Success Criteria Results

- Deterministic recent sample: met. Final verifier scanned 96 PRs, collected 67 artifacts, and selected 12 recent PRs with a lane-aware rule.
- Truthful per-PR verdicts with internal evidence: met. Final report attached Azure or availability metadata to every sampled PR.
- Clean approvals remain healthy while failure-shaped outcomes remain distinguishable: met. Live sample resolved 11 `clean-valid` and 1 `findings-published`; tested paths still cover publish failures and suspicious approvals.
- Rerunnable operator surface exists: met. `verify:m044` and `docs/runbooks/recent-review-audit.md` are now the final surface.

## Definition of Done Results

- [x] Real operator command shipped: `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json`
- [x] Final packaged runbook shipped: `docs/runbooks/recent-review-audit.md`
- [x] GitHub-visible recent sample selection is deterministic and documented
- [x] Internal evidence correlation works through current Azure publication signals even when DB access is unavailable
- [x] Milestone validation passed and the final live verifier run succeeded

## Requirement Outcomes

- **R045** moved from active to validated. Evidence: `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json` now returns a deterministic 12-PR recent sample with stable verdicts and source-availability data, and `docs/runbooks/recent-review-audit.md` documents how operators rerun and investigate the audit.
- No active M044-scoped requirement remains unmet after the final validation pass.

## Deviations

The final operator package uses the alias `verify:m044`, but the implementation file and JSON `command` field still carry the historical `verify:m044:s01` name. This is cosmetic and does not affect the operator surface or the audit result.

## Follow-ups

None required for M044 closure. Future cleanup could align the implementation filename / JSON `command` field with `verify:m044`, but that is not required for the shipped audit capability.
