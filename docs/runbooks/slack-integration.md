# Slack Integration Runbook (v1)

Use this runbook for deploying and operating Slack integration for Kodiai in `#kodiai`.

Primary goal: keep Slack behavior deterministic and thread-only while giving responders a fast path from symptom to root cause.

## Scope and Contract

- Slack v1 allows only addressed traffic in the configured Kodiai channel and replies in-thread.
- Top-level bootstrap requires an explicit mention of the bot user (`<@SLACK_BOT_USER_ID>`).
- In-thread follow-up is allowed only after session bootstrap for that channel+thread.
- Service must acknowledge Slack events immediately; async processing happens after HTTP 200.

## Deployment Flow

Run this sequence on every Slack rollout.

1. Confirm runtime config is present (see environment table below).
2. Confirm bot token scopes include at least `chat:write` and `reactions:write`.
3. Deploy using normal Azure flow in `deployment.md`.
4. Validate health endpoints return success.
5. Run mandatory Slack verification commands.

### Preflight Checks

Before deployment, confirm:

- `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_BOT_USER_ID`, and `SLACK_KODIAI_CHANNEL_ID` are set for the target environment.
- `SLACK_ASSISTANT_MODEL` is set explicitly for production (or accept default in `src/config.ts`).
- Startup logs do not include missing-scope guidance from Slack preflight (`auth.test`).

### Mandatory Post-Deploy Verification

These checks are release gates after deploy and after any Slack incident fix:

```sh
bun run verify:phase80:smoke
bun run verify:phase80:regression
```

Expected result: all `SLK80-SMOKE-*` and `SLK80-REG-*` checks pass with final verdict `PASS`.

### Rollback Notes

If any Slack verification gate fails in production:

- Roll back to the previous healthy Container App revision.
- Keep Slack changes blocked until smoke and regression are both green.
- Attach failing check IDs and log evidence to the incident ticket.

## Environment Variables

Use this table as source of truth for Slack operation-specific config.

| Variable | Required | Source of truth | Failure symptoms if wrong/missing |
| --- | --- | --- | --- |
| `SLACK_SIGNING_SECRET` | Yes | Slack App -> Basic Information -> App Credentials | Ingress returns 401; logs show verification failed in `src/routes/slack-events.ts` |
| `SLACK_BOT_TOKEN` | Yes | Slack App -> OAuth & Permissions -> Bot User OAuth Token | No thread replies; reaction add/remove failures; Slack API auth errors |
| `SLACK_BOT_USER_ID` | Yes | Slack App user ID for installed bot | Mentions ignored as missing bootstrap mention in `src/slack/safety-rails.ts` |
| `SLACK_KODIAI_CHANNEL_ID` | Yes | Slack channel ID for `#kodiai` in target workspace | All events ignored as outside channel in safety rails |
| `SLACK_ASSISTANT_MODEL` | Recommended | Runtime env config (`src/config.ts`) | Unexpected model behavior or fallback to default model |
| `LOG_LEVEL` | Recommended | Runtime env config (`src/config.ts`) | Missing diagnostics during triage |
| `BOT_ALLOW_LIST` | Optional | Runtime env config (`src/config.ts`) | Bot filtering may reject expected aliases in non-Slack flows |

Related baseline runtime vars (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `CLAUDE_CODE_OAUTH_TOKEN`) remain required per `deployment.md`.

## Incident Triage

Start with the delivery evidence model from `docs/runbooks/xbmc-ops.md`: capture timestamp, message URL, and correlated app logs.

### 1) Signature failures

Symptom:

- Slack event requests return HTTP 401.
- Logs show `Rejected Slack event: verification failed`.

Checks:

```sh
# Local validator sanity (replace placeholders)
curl -i -X POST http://localhost:3000/slack/events \
  -H "x-slack-request-timestamp: <ts>" \
  -H "x-slack-signature: v0=<sig>" \
  -H "Content-Type: application/json" \
  --data-binary @tmp/slack-event.json
```

Code pointers:

- `src/routes/slack-events.ts` (raw body handling + 401 path)
- `src/slack/verify.ts` (signature verification)

### 2) Events ignored unexpectedly

Symptom:

- No assistant reply and log includes `Slack event ignored by v1 safety rails`.

Checks:

- Inspect `reason` field in logs (`outside_kodiai_channel`, `missing_bootstrap_mention`, `thread_follow_up_out_of_scope`, etc.).
- Verify channel ID and mention token configuration values.

Code pointers:

- `src/slack/safety-rails.ts` (decision reasons)
- `src/routes/slack-events.ts` (rail invocation and ignore logging)

### 3) Missing thread replies after accepted event

Symptom:

- Logs show addressed event accepted, but no Slack thread message appears.

Checks:

- Confirm async path emitted `Slack addressed event accepted for async processing`.
- Check assistant execution and publish path logs for failures.
- Validate repo context message was not answered with clarifying question unexpectedly.

Code pointers:

- `src/routes/slack-events.ts` (async callback and accepted/failed log lines)
- `src/slack/assistant-handler.ts` (workspace execution, publishInThread, clarification path)

### 4) Reaction add/remove failures (working indicator)

Symptom:

- Assistant still replies, but hourglass reaction behavior is missing or inconsistent.

Checks:

- Confirm bot token has `reactions:write`.
- Review startup preflight logs for missing scope warnings.
- Verify add/remove handlers are wired in Slack client integration.

Code pointers:

- `src/slack/assistant-handler.ts` (add/remove working reaction calls)
- `src/slack/client.ts` (Slack API reaction integration)

### 5) Ambiguous repo clarification loops

Symptom:

- Assistant repeatedly asks for owner/repo clarification.

Checks:

- Confirm message contains at most one explicit `owner/repo` override.
- Confirm clarification text is deterministic and appears once per ambiguous input.

Code pointers:

- `src/slack/repo-context.ts` (repo parsing and ambiguity detection)
- `src/slack/assistant-handler.ts` (clarification-required publish path)

## Operator Command Quick Reference

```sh
# Slack v1 contract smoke
bun run verify:phase80:smoke

# Slack regression gate (release blocking)
bun run verify:phase80:regression
```

Always capture full CLI output and failing check IDs when escalating incidents.
