# Phase 77: User Setup Required

**Generated:** 2026-02-18
**Phase:** 77-slack-ingress-safety-rails
**Status:** Incomplete

Complete these items for Slack ingress to function. Claude automated all repository-side code changes; the items below require Slack workspace/app dashboard access.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `SLACK_SIGNING_SECRET` | Slack App Settings -> Basic Information -> Signing Secret | runtime secrets/env (`.env.local` for local dev) |
| [ ] | `SLACK_BOT_USER_ID` | Slack App Home -> App ID / Bot User ID | runtime secrets/env (`.env.local` for local dev) |
| [ ] | `SLACK_KODIAI_CHANNEL_ID` | Slack workspace -> `#kodiai` channel details -> Channel ID | runtime secrets/env (`.env.local` for local dev) |

## Dashboard Configuration

- [ ] **Enable Slack Events API and configure request URL**
  - Location: Slack App Settings -> Event Subscriptions
  - Set to: Enable Event Subscriptions
  - Request URL: `https://<your-kodiai-domain>/webhooks/slack/events`
  - Notes: Slack will send a `url_verification` challenge that now succeeds only when request signing headers are valid.

## Verification

After completing setup, verify with:

```bash
bun test ./src/slack/verify.test.ts --timeout 30000
bun test ./src/routes/slack-events.test.ts --timeout 30000
bunx tsc --noEmit
```

Expected results:
- All tests pass.
- Typecheck passes.
- Slack Event Subscriptions URL verification succeeds for the configured endpoint.

---

**Once all items complete:** Mark status as "Complete" at top of file.
