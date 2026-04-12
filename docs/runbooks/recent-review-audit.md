# Recent Review Audit Runbook

Use this runbook to audit the most recent Kodiai-reviewed `xbmc/xbmc` pull requests and determine whether approval-shaped outcomes are genuinely clean reviews, published finding reviews, visible publish failures, suspicious approvals, or still indeterminate.

## Command

```sh
bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json
```

Default behavior:
- samples the most recent `xbmc/xbmc` Kodiai-reviewed PRs found through GitHub-visible Kodiai markers
- applies the lane-stratified rule (up to 6 automatic + up to 6 explicit, then fill by recency)
- prints truthful preflight for GitHub, DB, and Azure evidence access
- emits per-PR evidence rows and a milestone-level verdict summary

## Prerequisites

### Required

- GitHub App access for the target repo:
  - `GITHUB_APP_ID`
  - `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`

### Optional but useful

- `DATABASE_URL`
  - used for DB-backed automatic-lane evidence when reachable
  - if unreachable, the verifier must fail open and report `databaseAccess=missing|unavailable`

### Azure / Log Analytics

The verifier uses Azure Log Analytics for current publication truth when available.

Expected environment / assumptions:
- Azure CLI installed and authenticated (`az account show` succeeds)
- default resource group: `rg-kodiai`
- if workspace discovery needs an override, set:
  - `AZURE_LOG_WORKSPACE_IDS=<customerId>[,<customerId>...]`
- if the app resource group differs, set:
  - `ACA_RESOURCE_GROUP=<resource-group>`

## What the verifier is looking at

### GitHub-visible surfaces

The audit scans the same public surfaces the runtime already trusts:
- PR reviews
- PR issue comments
- PR review comments

It extracts review identity from both marker shapes:
- `<!-- kodiai:review-output-key:... -->`
- `<!-- kodiai:review-details:... -->`

### Internal evidence

When available, the verifier correlates those GitHub artifacts with:
- DB-backed automatic review evidence (`reviews`, `findings`, `review_checkpoints`, `telemetry_events`)
- Azure `ContainerAppConsoleLogs_CL` publication signals

### Azure publication signals currently used

Automatic lane:
- `evidenceType="review"` + `outcome="submitted-approval"` → clean approval path
- `evidenceType="review"` + `outcome="published-output"` → findings were published

Explicit `@kodiai review` lane:
- `Mention execution completed` + `publishResolution="approval-bridge"` → clean-valid
- `publishResolution="idempotency-skip"` → clean-valid
- `publishResolution="duplicate-suppressed"` → clean-valid duplicate-safe recovery
- `publishResolution="publish-failure-fallback"` → publish-failure
- `publishResolution="publish-failure-comment-failed"` → publish-failure
- `publishResolution="executor"` → findings-published

## Report fields to inspect first

### `preflight`

- `githubAccess`
  - `available` means live GitHub sampling worked
- `databaseAccess`
  - `available`, `missing`, or `unavailable`
- `azureLogAccess`
  - `available`, `missing`, or `unavailable`
- `explicitPublishResolution`
  - currently remains `unavailable` as a top-level preflight capability flag; explicit publish truth is still surfaced per artifact from Azure rows

### `selection`

Key sanity checks:
- `scannedPullRequests` > 0
- `collectedArtifacts` > 0
- `candidateLaneCounts` shows how much recent coverage existed per lane
- `selectedLaneCounts` shows the final sample mix
- `fillCount` tells you how much one lane had to fill because the other had fewer recent candidates

### `summary`

- `totalArtifacts`
- `verdictCounts`
- `laneCounts`

This is the fastest way to answer, "did the current recent sample still look healthy overall?"

## Verdict meanings

### `clean-valid`

The audit found internal evidence that the approval-shaped outcome is expected and healthy.

Examples:
- automatic lane Azure `submitted-approval`
- explicit lane `publishResolution=approval-bridge`
- explicit lane duplicate-safe / idempotent resolution

### `findings-published`

The audit found evidence that findings were actually published.

Examples:
- automatic lane Azure `published-output`
- explicit lane `publishResolution=executor`

### `publish-failure`

The audit found a real publish-failure path, not a quiet clean review.

Examples:
- explicit lane `publishResolution=publish-failure-fallback`
- explicit lane `publishResolution=publish-failure-comment-failed`

### `suspicious-approval`

The audit found contradictory evidence that suggests a review recorded issues but no matching published finding output for the sampled artifact.

This is a real investigation trigger.

### `indeterminate`

The audit does not have enough trustworthy internal evidence to classify the PR beyond the GitHub-visible surface.

This is not a hidden failure verdict. It means the evidence surface was missing, unavailable, or contradictory.

## How to investigate one flagged PR

Take the `reviewOutputKey` from the verifier output.

### 1) Re-run the verifier for the same recent window

```sh
bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json
```

Confirm the same PR is still in the sample and the verdict is stable.

### 2) Inspect the PR directly on GitHub

Look at:
- `prUrl`
- `sourceUrl`
- whether the artifact came from `review`, `issue-comment`, or `review-comment`

### 3) Search Azure logs by `reviewOutputKey`

The verifier already does this, but for manual drill-down use a bounded query shaped like:

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(14d)
| where Log_s has "<reviewOutputKey>"
| project TimeGenerated, Log_s, RevisionName_s, ContainerAppName_s
| order by TimeGenerated asc
| take 40
```

What to look for:
- automatic lane:
  - `Review output idempotency check passed`
  - `Evidence bundle` with `outcome=published-output|submitted-approval`
- explicit lane:
  - `Explicit mention review idempotency check passed`
  - `Attempting explicit mention review approval publish`
  - `Mention execution completed` with `publishResolution=...`

### 4) If the case is still `indeterminate`

Check which source was unavailable:
- DB unavailable → verifier should already say so in `sourceAvailability`
- Azure unavailable or missing rows → confirm `az account show` and workspace discovery assumptions
- contradictory signals → keep the artifact flagged and do not reclassify by intuition

## Expected current healthy shape

A healthy recent sample can legitimately contain:
- many `clean-valid` verdicts
- some `findings-published`
- zero `publish-failure`
- zero `suspicious-approval`

A sample with only approvals on GitHub is **not** automatically suspicious if the internal evidence resolves them to `clean-valid`.

## Escalation guidance

Escalate when:
- `publish-failure` appears for any recent PR
- `suspicious-approval` appears for any recent PR
- the sample degrades back to mostly `indeterminate` because Azure evidence vanished unexpectedly
- GitHub sampling fails (`githubAccess != available`)

## Related references

- `docs/runbooks/review-requested-debug.md`
- `docs/runbooks/mentions.md`
- `docs/deployment.md`
- `scripts/verify-m044-s01.ts`
