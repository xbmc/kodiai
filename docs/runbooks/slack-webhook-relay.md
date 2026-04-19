# Slack Webhook Relay Runbook

Use this runbook to configure and operate Kodiai's inbound webhook-to-Slack relay surface.

## Scope

This feature is **not** part of `.kodiai.yml`. It is service-level runtime configuration loaded from environment variables at process startup.

Use the relay when you want an external system to POST a small, verified event payload into Kodiai and have Kodiai relay selected events into Slack with explicit filtering and explicit suppression/failure outcomes.

## Route Contract

Inbound relay requests land on:

- `POST /webhooks/slack/relay/:sourceId`

Where `:sourceId` must match one configured relay source in `SLACK_WEBHOOK_RELAY_SOURCES`.

## Runtime Configuration

Configure relay sources with `SLACK_WEBHOOK_RELAY_SOURCES` in the app environment.

Example:

```bash
SLACK_WEBHOOK_RELAY_SOURCES='[
  {
    "id": "buildkite",
    "targetChannel": "C_BUILD_ALERTS",
    "auth": {
      "type": "header_secret",
      "headerName": "x-relay-secret",
      "secret": "super-secret"
    },
    "filter": {
      "eventTypes": ["build.failed", "build.finished"],
      "textIncludes": ["failed"],
      "textExcludes": ["flaky"]
    }
  }
]'
```

### Config rules

- `id` — stable source identifier used in the route path
- `targetChannel` — Slack channel ID for accepted events
- `auth.type` — currently only `header_secret`
- `auth.headerName` — request header carrying the shared secret
- `auth.secret` — expected secret value
- `filter.eventTypes` — allowlist of event types; empty means any event type
- `filter.textIncludes` — every listed substring must appear in `text`
- `filter.textExcludes` — any listed substring suppresses the event

## Payload Contract

The inbound payload must already use Kodiai's generic relay schema:

```json
{
  "eventType": "build.failed",
  "title": "Build failed on main",
  "summary": "CI failed for xbmc/xbmc after the latest merge.",
  "url": "https://ci.example.test/builds/123",
  "text": "Build failed for xbmc/xbmc on main after merge 09f28d7.",
  "metadata": {
    "provider": "buildkite",
    "pipeline": "main"
  }
}
```

Required fields:

- `eventType`
- `title`
- `summary`
- `url` (valid absolute URL)
- `text`

Optional fields:

- `metadata` (object)

Kodiai does **not** perform source-specific field mapping in the route layer. If your upstream system uses a different payload shape, normalize it before sending the relay request.

## Outcome Vocabulary

The relay surface is intentionally explicit.

### 202 Accepted / Delivered path

```json
{
  "ok": true,
  "verdict": "accept",
  "sourceId": "buildkite",
  "eventType": "build.failed",
  "targetChannel": "C_BUILD_ALERTS"
}
```

Meaning: source auth passed, payload was valid, filters allowed it, and Kodiai handed it to Slack delivery.

### 202 Suppressed path

```json
{
  "ok": true,
  "verdict": "suppress",
  "reason": "text_excluded_substring",
  "sourceId": "buildkite",
  "eventType": "build.failed",
  "detail": "flaky"
}
```

Meaning: the event was understood but intentionally filtered out. No Slack post occurs.

Current suppression reasons:

- `event_type_not_allowed`
- `text_missing_required_substring`
- `text_excluded_substring`

### 400 Malformed payload

```json
{
  "ok": false,
  "reason": "malformed_payload",
  "issues": ["text", "url"]
}
```

Meaning: the request body parsed as JSON, but it did not satisfy the relay payload contract.

### 400 Invalid JSON

```json
{
  "ok": false,
  "reason": "invalid_json"
}
```

### 401 Invalid source auth

```json
{
  "ok": false,
  "reason": "invalid_source_auth"
}
```

### 404 Unknown source

```json
{
  "ok": false,
  "reason": "unknown_source"
}
```

### 502 Delivery failure

```json
{
  "ok": false,
  "reason": "delivery_failed",
  "sourceId": "buildkite",
  "eventType": "build.failed"
}
```

Meaning: the event passed auth, parsing, and filtering, but the downstream Slack post failed.

## Message Shape

Accepted events are posted through the shared Slack client as one standalone message:

```text
*Build failed on main*
CI failed for xbmc/xbmc after the latest merge.
Build failed for xbmc/xbmc on main after merge 09f28d7.
<https://ci.example.test/builds/123|Open event>
Source: `buildkite` · Event: `build.failed`
```

## Proof Surfaces

Primary proof command:

```bash
bun run verify:m052
```

That command composes the S01 contract verifier and the S02 route+delivery verifier, so it exercises accepted, suppressed, and failed-delivery outcomes from one surface.

Lower-level diagnostics are still available when you need to isolate a layer:

```bash
bun test ./src/config.test.ts ./src/slack/webhook-relay-config.test.ts
bun test ./src/slack/webhook-relay.test.ts
bun test ./src/routes/slack-relay-webhooks.test.ts ./src/slack/webhook-relay-delivery.test.ts
bun test ./scripts/verify-m052-s01.test.ts ./src/slack/webhook-relay.test.ts
bun test ./scripts/verify-m052-s02.test.ts ./src/routes/slack-relay-webhooks.test.ts ./src/slack/webhook-relay-delivery.test.ts
```

## Troubleshooting

### `unknown_source`
- Check the route path source id matches `SLACK_WEBHOOK_RELAY_SOURCES[].id`.
- Confirm the process has been restarted after env changes.

### `invalid_source_auth`
- Check the request includes the configured header name.
- Check the header value matches the configured secret exactly.

### `invalid_json`
- The request body was not valid JSON.
- Re-send with `Content-Type: application/json` and a syntactically valid body.

### `malformed_payload`
- The JSON body parsed, but required fields are missing or invalid.
- Inspect the returned `issues` array and fix the payload shape upstream.

### `suppress`
- The payload was valid, but the source filter blocked it.
- Check `eventTypes`, `textIncludes`, and `textExcludes` against the returned `reason` and `detail`.

### `delivery_failed`
- The event passed ingress and filtering but Slack delivery failed.
- Check Slack bot auth/scopes and the target channel id.
- Re-run the route/delivery proof bundle to confirm whether the failure is runtime-only or contract drift.
