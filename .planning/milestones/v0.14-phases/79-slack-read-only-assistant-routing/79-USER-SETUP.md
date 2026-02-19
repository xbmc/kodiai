# Phase 79: User Setup Required

**Generated:** 2026-02-18
**Phase:** 79-slack-read-only-assistant-routing
**Status:** Incomplete

Complete these items for Slack assistant thread replies to function in production.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `SLACK_BOT_TOKEN` | Slack App -> OAuth & Permissions -> Bot User OAuth Token | Runtime environment |

## Dashboard Configuration

- [ ] **Ensure bot token has `chat:write` scope for `#kodiai` thread replies**
  - Location: Slack App -> OAuth & Permissions -> Bot Token Scopes
  - Notes: Reinstall app to workspace if scopes change.

## Verification

After completing setup, verify with:

```bash
bun test ./src/slack/client.test.ts --timeout 30000
bun test ./src/routes/slack-events.test.ts --timeout 30000
```

Expected results:
- Slack publish contract tests pass.
- Slack ingress routing tests pass.

---

**Once all items complete:** Mark status as "Complete" at top of file.
