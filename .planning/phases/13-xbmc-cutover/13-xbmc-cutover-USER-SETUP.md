# Phase 13: User Setup Required

**Generated:** 2026-02-10
**Phase:** 13-xbmc-cutover
**Status:** Complete

This phase required manual GitHub configuration for `xbmc/xbmc`. All automatable work was handled in-repo; these items required GitHub App installation and webhook verification.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| n/a | n/a | n/a | n/a |

## Account Setup

- [x] **Install Kodiai GitHub App**
  - URL: GitHub App settings (Kodiai)
  - Target: `xbmc/xbmc` (or the xbmc org with repo access)

## Dashboard Configuration

- [x] **Configure webhook delivery for xbmc/xbmc**
  - Location: GitHub App Settings -> Advanced -> Webhook
  - Set to: `https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github`
  - Notes: Deliveries should show HTTP 200 for valid signatures.

## Verification

After completing setup, verify via GitHub + logs:

- GitHub App Settings -> Advanced -> Recent Deliveries
  - Confirm at least one `issue_comment` delivery from `xbmc/xbmc` shows HTTP 200.
  - Confirm the payload corresponds to a real trigger (e.g., `@claude ...` on a PR).

- Azure Container Apps logs
  - Confirm webhook delivery is accepted and mention execution completes with `published=true`.

Reference runbook: `docs/runbooks/xbmc-cutover.md`

---

**Once all items complete:** Keep status as "Complete".
