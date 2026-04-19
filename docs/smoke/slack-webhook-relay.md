# Slack Webhook Relay Smoke

Use this smoke path when validating the inbound webhook-to-Slack relay surface from a clean environment.

Primary proof command:

```bash
bun run verify:m052
```

Use the curl flows below when you want to exercise the HTTP route directly.

## Preconditions

- `SLACK_WEBHOOK_RELAY_SOURCES` is configured on the target instance.
- The target source id in this example is `buildkite`.
- The configured source auth header is `x-relay-secret`.
- The shared Slack bot config is already valid for the target environment.

## Accepted flow

```bash
curl -i -X POST http://localhost:3000/webhooks/slack/relay/buildkite \
  -H 'content-type: application/json' \
  -H 'x-relay-secret: super-secret' \
  --data-binary '{
    "eventType": "build.failed",
    "title": "Build failed on main",
    "summary": "CI failed for xbmc/xbmc after the latest merge.",
    "url": "https://ci.example.test/builds/123",
    "text": "Build failed for xbmc/xbmc on main after merge 09f28d7.",
    "metadata": {"provider": "buildkite", "pipeline": "main"}
  }'
```

Expected result:

- HTTP `202`
- JSON body contains `"verdict":"accept"`
- Slack receives one standalone message in the configured target channel

## Suppressed flow

```bash
curl -i -X POST http://localhost:3000/webhooks/slack/relay/buildkite \
  -H 'content-type: application/json' \
  -H 'x-relay-secret: super-secret' \
  --data-binary '{
    "eventType": "build.failed",
    "title": "Flaky build failure",
    "summary": "A known flaky test failed in CI.",
    "url": "https://ci.example.test/builds/124",
    "text": "Build failed because of a flaky test in the UI suite.",
    "metadata": {"provider": "buildkite", "pipeline": "main"}
  }'
```

Expected result:

- HTTP `202`
- JSON body contains `"verdict":"suppress"`
- JSON body contains `"reason":"text_excluded_substring"`
- No Slack message is posted

## Failed-delivery flow

Use the same accepted payload against a non-production or local environment where Slack delivery is intentionally broken (for example: invalid `SLACK_BOT_TOKEN`, blocked Slack egress, or a mocked failing delivery path in test).

```bash
curl -i -X POST http://localhost:3000/webhooks/slack/relay/buildkite \
  -H 'content-type: application/json' \
  -H 'x-relay-secret: super-secret' \
  --data-binary '{
    "eventType": "build.failed",
    "title": "Build failed on main",
    "summary": "CI failed for xbmc/xbmc after the latest merge.",
    "url": "https://ci.example.test/builds/123",
    "text": "Build failed for xbmc/xbmc on main after merge 09f28d7.",
    "metadata": {"provider": "buildkite", "pipeline": "main"}
  }'
```

Expected result in that intentionally broken environment:

- HTTP `502`
- JSON body contains `"reason":"delivery_failed"`
- No successful Slack post occurs

## Route result map

- `accept` — payload was valid, filters allowed it, Slack delivery path ran
- `suppress` — payload was valid, but filtering intentionally blocked delivery
- `delivery_failed` — payload passed ingress and filtering, but Slack post failed
- `invalid_json` — request body was not valid JSON
- `malformed_payload` — JSON parsed, but required relay fields were missing or invalid
- `invalid_source_auth` — source auth header missing or wrong
- `unknown_source` — route source id does not exist in `SLACK_WEBHOOK_RELAY_SOURCES`

## What to cite in issue closure / incident review

- `bun run verify:m052`
- `docs/runbooks/slack-webhook-relay.md`
- The exact HTTP result body from the curl smoke flow (`accept`, `suppress`, or `delivery_failed`)
