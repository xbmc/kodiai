# M049/S02 Research — Live proof and auditability verification

## Executive Summary

This is **targeted research**, not deep discovery. S01 already shipped the visible clean-approval body contract and covered it locally through focused handler/MCP tests. S02 should stay **verifier-only** unless live proof exposes an actual regression.

The missing capability is not another publisher change. The real gap is a live proof surface that can show, for one explicit clean `@kodiai review` run:

1. exactly **one** GitHub-visible artifact exists for the `reviewOutputKey`,
2. that artifact is an **APPROVED review** rather than an issue comment or inline review comment,
3. the live review body matches the new visible shared contract (`Decision: APPROVE`, `Issues: none`, `Evidence:`, 1–3 bullets, marker, no `<details>` wrapper), and
4. the same published body still correlates cleanly to the delivery through the existing Azure-log audit signals.

The cleanest path is a new live verifier script for S02, driven by one explicit-lane `reviewOutputKey`, reusing the existing GitHub App + Azure log patterns already present in `scripts/verify-m044-s01.ts` and `scripts/verify-m048-s01.ts`.

Per `superpowers:verification-before-completion`, the slice is not proven until the new live verifier command is run fresh against a real explicit clean-approval artifact.

## Active Requirements / Product Contract

### Active requirement supported by this slice

- **R043** — explicit PR mention review requests must execute the review lane and publish exactly one visible GitHub outcome instead of succeeding silently.

S02 is the live re-verification seam for that requirement after S01 changed the clean approval from marker-only text to the shared visible evidence-backed body.

### Product/decision continuity that constrains S02

- **D098** — clean approvals should publish one shared short evidence-backed GitHub review body, not a separate clean issue comment.
- **D116** — the clean approval body grammar is visible plain markdown with `Decision: APPROVE`, `Issues: none`, an `Evidence:` block, 1–3 bullets, and the existing `review-output-key` marker.
- **D117** — approve-via-comment must promote only that same shared APPROVE grammar.

### Slice acceptance from the roadmap state

S02 needs proof that:
- operators inspecting a clean approval on GitHub can see **why** it was approved without a separate PR comment, and
- audit tooling can correlate that same published body back to the delivery cleanly.

Given the active requirement context loaded for auto-mode, the safest narrow target is the **explicit `@kodiai review` clean-approval lane**. Automatic clean-approval publishing is already covered locally by S01 tests and can remain secondary unless milestone closure later demands a second live sample.

## What Exists Today

### 1) The live approval-body contract is already centralized

**File:** `src/handlers/review-idempotency.ts`

Relevant seams:
- `buildApprovedReviewBody(...)`
- `buildReviewOutputMarker(...)`
- `extractReviewOutputKey(...)`
- `parseReviewOutputKey(...)`
- `ensureReviewOutputNotPublished(...)`

Important facts for S02:
- `buildApprovedReviewBody(...)` is now the source of truth for the visible clean-approval body.
- `extractReviewOutputKey(...)` and `parseReviewOutputKey(...)` let a verifier recover the exact `reviewOutputKey`, delivery id, PR number, owner/repo, and action from the live body itself.
- `ensureReviewOutputNotPublished(...)` already knows how to scan all three GitHub-visible surfaces (issue comments, review comments, reviews), but it only returns **presence/absence**, not full matching artifact details.

That last point is the main missing primitive for S02.

### 2) Explicit clean approval publication already emits the right audit signals

**File:** `src/handlers/mention.ts`

Relevant live behavior on the explicit review lane:
- publishes the clean outcome through `pulls.createReview({ event: "APPROVE" ... })`
- uses `buildApprovedReviewBody({ reviewOutputKey, evidence })`
- logs `publishResolution` on completion
- clean terminal explicit values are already distinguished:
  - `approval-bridge`
  - `idempotency-skip`
  - `duplicate-suppressed`

This is good news for S02: the audit half of the story already exists. The verifier does **not** need to invent a new correlation mechanism.

### 3) Automatic clean approval now uses the same body, but that is probably not the first live-proof target

**File:** `src/handlers/review.ts`

Relevant behavior:
- the automatic clean-review lane now also uses `buildApprovedReviewBody(...)`
- it logs `evidenceType: "review"` with outcome `submitted-approval`
- it preserves the existing idempotency scan before publication

This makes the automatic lane a good reference surface, but the active requirement tied to this slice is still R043’s explicit mention lane. Keep S02 narrow unless the milestone explicitly demands dual-lane live proof.

### 4) Existing GitHub artifact sampling is close, but too lossy for S02

**File:** `src/review-audit/recent-review-sample.ts`

This helper already:
- scans review comments, issue comments, and reviews,
- extracts `reviewOutputKey` markers from bodies,
- classifies artifacts into `automatic` vs `explicit` lanes.

But it is intentionally shaped for **sampling recent PRs**, not for exact proof of one run:
- it keeps only the **latest** valid artifact per PR,
- it does **not** preserve the full body for contract validation,
- it does **not** keep review state (`APPROVED`, `COMMENTED`, etc.),
- it does **not** report exact per-surface counts for one `reviewOutputKey`.

So S02 should not try to stretch this directly into an exact-count verifier without adding a dedicated “collect all matching artifacts” seam.

### 5) Existing audit correlation already solves the log side

**File:** `src/review-audit/evidence-correlation.ts`

Key behavior:
- `buildExplicitLaneEvidenceFromLogs(...)` extracts `publishResolution` from Azure rows.
- `classifyReviewArtifactEvidence(...)` already treats explicit clean publish results as `clean-valid` when `publishResolution` is one of:
  - `approval-bridge`
  - `idempotency-skip`
  - `duplicate-suppressed`

So the Azure-log interpretation rule is already established. S02 mostly needs to add the **GitHub artifact/body** half, then join it to this existing explicit-lane evidence.

### 6) There are already two strong live-verifier patterns to copy

**Files:**
- `scripts/verify-m044-s01.ts`
- `scripts/verify-m048-s01.ts`

What they give you:
- `verify-m044-s01.ts` already knows how to:
  - load GitHub App credentials from env,
  - build a live installation Octokit client,
  - discover Azure Log Analytics workspaces,
  - query logs,
  - return truthful access-state metadata instead of pretending everything is available.
- `verify-m048-s01.ts` already shows the repo’s preferred shape for:
  - `reviewOutputKey`-driven live proof,
  - stable `status_code` contracts,
  - human + JSON output,
  - “missing evidence” vs “failed proof” separation.

S02 should look like a combination of those two patterns.

### 7) No M049/S02 verifier exists yet

**File:** `package.json`

There is currently:
- no `verify:m049:s02` script,
- no `scripts/verify-m049-s02.ts`,
- no S02-specific review-output artifact collector.

So the work is likely isolated to `scripts/` + `src/review-audit/` + tests, not the handlers.

## Key Constraints / Surprises

### A) “Exactly one visible outcome” requires **all-surface counting**, not latest-artifact sampling

The current live audit tooling can tell you that a marker-backed artifact exists and that its lane is explicit/automatic. That is not enough for R043/S02.

S02 needs exact proof that, for one `reviewOutputKey`, there are:
- **0** matching issue comments,
- **0** matching review comments,
- **1** matching review.

That count is the real “one visible GitHub outcome” proof.

### B) The body-proof job is separate from the audit-correlation job

Existing explicit audit evidence can classify a live artifact as “clean-valid” from logs alone, but it does **not** prove the live GitHub body is the new shared visible contract.

S02 therefore needs both:
- GitHub artifact inspection, and
- Azure log correlation.

Do not collapse them into one vague pass/fail check.

### C) Use GitHub API / Octokit for proof, not browser automation

Pi’s browser tools are for local web apps, not external sites. For GitHub proof, the verifier should fetch bodies and URLs through the GitHub API and output the `html_url` so operators can inspect the same artifact manually.

That means the live proof is API-backed, not screenshot-backed.

### D) `reviewOutputKey` is already the right CLI identity

Because `parseReviewOutputKey(...)` yields:
- owner/repo,
- PR number,
- action,
- delivery id,
- head SHA,

a narrow S02 verifier can take just:
- `--repo <owner/repo>` (or default to `xbmc/kodiai`)
- `--review-output-key <key>`
- `--json`

No separate PR number flag is necessary.

### E) Keep the verifier narrow to the explicit lane

To stay aligned with R043 and avoid scope drift, the new verifier should **reject** non-explicit keys (anything whose parsed action is not `mention-review`) with a named invalid-arg or wrong-lane status.

That mirrors the pattern in `scripts/verify-m048-s03.ts`, which rejects non-synchronize keys for the synchronize proof.

### F) Truthful degradation matters more than “always green” behavior

Following `superpowers:verification-before-completion`, the verifier should never quietly treat missing live access as success.

It should explicitly distinguish at least:
- missing GitHub credentials/access,
- missing Azure workspaces/log access,
- zero matching GitHub artifacts,
- duplicate/multi-surface publication,
- body contract drift,
- correlation mismatch.

### G) If a manual fallback uses `gh`, the loaded `gh` skill rule matters

The `gh` skill’s critical rule is: pass `-R owner/repo` on **every** `gh` command in proxy/agent environments.

That said, implementation code should prefer the repo’s existing `createGitHubApp(...)` + Octokit helper pattern instead of shelling out to `gh`.

## Recommendation

### Recommended implementation shape

I recommend a **two-layer S02 implementation**:

1. a small reusable GitHub artifact collector / validator in `src/review-audit/`, and
2. a new live verifier script `scripts/verify-m049-s02.ts` that consumes it and reuses the existing Azure-log evidence builder.

This keeps handler code untouched and confines S02 to the audit/verification boundary where it belongs.

### What the live verifier should prove

For one explicit clean-approval `reviewOutputKey`, the report should prove all of the following:

1. **Key identity is valid and explicit-lane**
   - `parseReviewOutputKey(...)` succeeds
   - parsed action is `mention-review`

2. **Exactly one GitHub-visible artifact exists**
   - counts by surface are exact
   - only one artifact matches across issue comments, review comments, and reviews

3. **The sole artifact is the right kind of artifact**
   - source is `review`
   - review state is `APPROVED`
   - artifact URL is captured for operator inspection

4. **The live body matches the shared visible contract**
   - contains `Decision: APPROVE`
   - contains `Issues: none`
   - contains `Evidence:`
   - contains 1–3 bullet lines
   - contains the same `review-output-key` marker
   - does **not** contain `<details>` / old wrapper text

5. **Audit correlation is still clean**
   - Azure logs are queried with the same `reviewOutputKey` + delivery id
   - explicit publish resolution lands in the clean set (`approval-bridge`, or the idempotent replay-safe equivalents if that is the live sample being checked)

### Suggested report shape

A good report envelope would include:
- `command`, `generated_at`, `repo`, `review_output_key`, `delivery_id`, `pr_number`
- `success`, `status_code`, `issues[]`
- `github.sourceAvailability`
- `github.artifactCounts` by surface
- `github.artifact` with `source`, `sourceUrl`, `reviewState`, `updatedAt`
- `bodyContract` booleans + `evidenceBulletCount`
- `audit.sourceAvailability`
- `audit.publishResolution`

That is enough for both human inspection and machine-checkable milestone proof.

### Reuse guidance

- Reuse `buildExplicitLaneEvidenceFromLogs(...)` rather than reparsing raw log JSON in a new way.
- Reuse the M044 GitHub App env-loader pattern if you want low risk.
- Only extract shared live-GitHub-context helpers from `verify-m044-s01.ts` if the extraction is **small and obviously reusable**. Do not churn M044 just to be “architecturally pure.”

## Natural Task Seams for the Planner

### Seam 1 — GitHub artifact collection + visible-body validator

**Files:**
- Create `src/review-audit/review-output-artifacts.ts` and `src/review-audit/review-output-artifacts.test.ts`
  - **or** extend `src/review-audit/recent-review-sample.ts` + `src/review-audit/recent-review-sample.test.ts`

Goal:
- fetch issue comments, review comments, and reviews for one PR
- filter all of them by exact `reviewOutputKey` marker match
- preserve full body, URL, source, timestamps, and review state
- add a pure validator for the visible APPROVE grammar and bullet count

Why this should go first:
- the live verifier depends on exact artifact counts and body parsing
- this is the most reusable seam if future milestones need more GitHub-output audits

### Seam 2 — M049/S02 live verifier script

**Files:**
- Create `scripts/verify-m049-s02.ts`
- Create `scripts/verify-m049-s02.test.ts`
- Modify `package.json`

Goal:
- parse `--repo`, `--review-output-key`, `--json`
- validate explicit-lane key boundary
- create live GitHub context with the app helper pattern
- collect matching artifacts
- validate exact-count + body-contract proof
- query Azure logs with the existing log adapter / explicit evidence builder
- render stable human + JSON reports with named status codes

This should be **verifier-only** work. It should not mutate GitHub state.

### Optional seam 3 — tiny shared live-GitHub-context extraction

**Files:**
- maybe refactor a tiny helper out of `scripts/verify-m044-s01.ts`

Goal:
- share repo parsing / GitHub App / private-key loading if duplication becomes annoying

Caution:
- only do this if the extraction is genuinely small
- do **not** widen S02 into a general verification-framework cleanup

## Verification

### Focused regression command

If S02 creates a new helper module:

```bash
bun test ./src/review-audit/review-output-artifacts.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m049-s02.test.ts
```

If it extends `recent-review-sample.ts` instead:

```bash
bun test ./src/review-audit/recent-review-sample.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m049-s02.test.ts
```

What this should prove:
- marker-matched artifact collection is correct across all three surfaces
- duplicate/multi-surface matches fail deterministically
- visible APPROVE body validation accepts the shipped grammar and rejects wrapper drift
- explicit Azure log evidence still maps clean publish resolutions correctly
- CLI arg parsing and report status codes are stable

### Type safety / drift check

```bash
bun run tsc --noEmit
```

### Fresh live proof command

```bash
bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key <key> --json
```

Per `superpowers:verification-before-completion`, this is the command that must run successfully before anyone claims S02 is actually proven.

### High-value failure modes to encode as status codes/tests

- `missing_review_output_key`
- `invalid_review_output_key`
- `wrong_lane`
- `missing_github_access`
- `no_matching_artifact`
- `duplicate_visible_outputs`
- `wrong_surface`
- `wrong_review_state`
- `body_contract_drift`
- `azure_unavailable` / `audit_unavailable`
- `audit_correlation_failed`
- `m049_s02_ok`

## Forward Intelligence

- **Start in `scripts/` + `src/review-audit/`, not in handlers.** S01 already proved the publishers locally. S02 should not reopen `mention.ts` / `review.ts` unless live evidence actually exposes drift.
- **Do not overload `recent-review-sample.ts`’s selection semantics by accident.** Its current job is “latest artifact per PR” sampling for M044, not exact-count proof for one key.
- **The best correlation chain in the repo is already GitHub body → `reviewOutputKey` → parsed delivery id → Azure logs.** Reuse it; don’t invent a second audit identity.
- **The live body contract should be checked against the shipped grammar, not a new prose summary.** The validator must mirror what S01 actually promised: `Decision: APPROVE`, `Issues: none`, `Evidence:`, 1–3 bullets, marker, no wrapper.
- **Idempotency-safe replay and first-run publish are different proof shapes.** If the live sample is a replayed explicit review, `idempotency-skip` / `duplicate-suppressed` may still be audit-valid, but it will only prove correlation/uniqueness, not fresh publication. Prefer a first-run clean approval sample if available.
- **If a human fallback inspects GitHub via CLI, use the loaded `gh` skill rule and always pass `-R xbmc/kodiai` (or the target repo).**

## Skill Discovery

Relevant installed skills already present:
- `gh` — useful for manual GitHub inspection; the key rule is to pass `-R` on every command.
- `github-bot` — available, but the repo already has a first-party GitHub App helper and does not need a separate bot integration for this slice.
- `verification-before-completion` — the relevant process rule for S02: do not claim live proof without a fresh verifier run.

External skill search result:
- `npx skills find "Azure Log Analytics"` returned **`microsoft/azure-skills@azure-kusto`** as the strongest candidate (highest install count and closest relevance), with smaller Azure Monitor / observability skills below it.

Recommendation:
- **Do not install any new skill for S02 by default.** The existing repo already has the needed Azure log adapter (`src/review-audit/log-analytics.ts`).
- If the slice later expands into deeper Kusto work, the best candidate is:

```bash
npx skills add microsoft/azure-skills@azure-kusto
```
