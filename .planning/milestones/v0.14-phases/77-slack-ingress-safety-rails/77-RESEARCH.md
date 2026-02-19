# Phase 77: Slack Ingress & Safety Rails - Research

**Researched:** 2026-02-17
**Domain:** Slack Events API ingress security, event gating, and v1 safety rails in existing Bun + Hono architecture
**Confidence:** HIGH

## User Constraints

No `*-CONTEXT.md` exists for this phase.

Locked by phase objective and requirements:
- SLK-01: validate Slack signatures/timestamps before processing events
- SLK-02: enforce v1 rails: `#kodiai` only, no DMs, thread-only replies, mention-only bootstrap
- Reuse existing Kodiai patterns: Hono routes, handlers, config/env parsing, test conventions

## Summary

This phase is mostly an ingress-hardening and policy-gating phase, not a Slack feature-completeness phase. The key technical requirement is **fail-closed request authenticity**: read raw request body first, validate Slack `X-Slack-Signature` and `X-Slack-Request-Timestamp` using the signing secret and a 5-minute replay window, and only then parse JSON. Slack explicitly documents this sequence and 5-minute tolerance. The existing Kodiai GitHub webhook route already follows the same raw-body-before-parse pattern, so implementation should mirror that shape.

For event handling, Slack requires a 2xx response within 3 seconds and recommends decoupling processing from the webhook thread. This aligns with current Kodiai fire-and-fork dispatch in `src/routes/webhooks.ts`. The Slack route should therefore acknowledge quickly (`200`) after verification and safety gating, then hand off work asynchronously.

For v1 rails, enforce deterministic gate decisions in a pure evaluator before downstream logic: allow only the configured channel ID, reject DM/MPDM/App Home channel types, reject bot/system subtypes, require top-level bootstrap mentions (`<@SLACK_BOT_USER_ID>` token) and derive thread target from the root message timestamp. This keeps phase scope strict and prevents accidental unsolicited posting.

**Primary recommendation:** Implement a verify-first Slack ingress route in Hono plus a pure `evaluateSlackV1Rails()` function (allow/ignore + reason code), with fail-closed auth checks and table-driven tests for all blocked/allowed paths.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hono` | `^4.11.8` (installed) | HTTP route for `/webhooks/slack/events` | Already used in app; supports raw body reads and modular route mounting |
| `zod` | `^4.3.6` (installed) | Fail-fast env validation for Slack settings | Existing config pattern in `src/config.ts` |
| `node:crypto` | Bun/Node built-in | HMAC-SHA256 + timing-safe compare | Slack signing algorithm requires HMAC; no external dependency needed |
| `pino` | `^10.3.0` (installed) | Structured logging of verify/rail decisions | Existing logging standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bun:test` | Bun built-in | Unit and route tests | Existing convention for deterministic regression coverage |
| `@slack/types` | `2.19.0` (reference only) | Canonical event field names/types | Use as schema reference; no runtime dependency required for this phase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-house Hono route + verifier | Bolt for JS receiver | Bolt is good but conflicts with existing route architecture and introduces framework split |
| Built-in crypto verifier | Third-party Slack verifier package | Extra dependency surface for simple, well-defined HMAC operation |
| Typed minimal local payload model | Full Slack event schema plumbing | Overkill for v1 rails; increases complexity before behavior is needed |

**Installation:**
```bash
# No new packages required for Phase 77
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── slack/
│   ├── verify.ts            # Slack signature + timestamp verification primitive
│   ├── types.ts             # Minimal Slack envelope/message types for v1 rails
│   └── safety-rails.ts      # Pure allow/ignore evaluator with reason codes
├── routes/
│   └── slack-events.ts      # POST /events ingress route (verify-first)
├── config.ts                # Add Slack env vars (fail-fast)
└── index.ts                 # Mount /webhooks/slack route module
```

### Pattern 1: Verify Before Parse
**What:** Read raw body, validate signature + timestamp, then parse JSON.
**When to use:** Every Slack ingress request.
**Example:**
```typescript
// Source: https://docs.slack.dev/authentication/verifying-requests-from-slack/
// and existing Kodiai pattern in src/routes/webhooks.ts
const rawBody = await c.req.text();
const ts = c.req.header("x-slack-request-timestamp") ?? "";
const sig = c.req.header("x-slack-signature") ?? "";

const result = verifySlackRequest({
  signingSecret: config.slackSigningSecret,
  rawBody,
  timestamp: ts,
  signature: sig,
  nowSeconds: Math.floor(Date.now() / 1000),
});

if (!result.valid) return c.text("", 401);
const payload = JSON.parse(rawBody) as SlackEventEnvelope;
```

### Pattern 2: Acknowledge Fast, Process Async
**What:** Return HTTP 200 quickly and process in detached async flow.
**When to use:** `event_callback` payloads after verification.
**Example:**
```typescript
// Source: https://docs.slack.dev/apis/events-api/ (respond within 3 seconds)
Promise.resolve()
  .then(() => processSlackEvent(normalizedEvent))
  .catch((err) => logger.error({ err }, "Slack event processing failed"));

return c.json({ ok: true });
```

### Pattern 3: Deterministic Rail Evaluator
**What:** Pure function returns `{ decision: "allow" | "ignore", reason, normalized? }`.
**When to use:** Immediately after verified `event_callback` parse.
**Example:**
```typescript
// Source: Phase requirement SLK-02 + existing pure-gate style (src/feedback/safety-guard.ts)
const rail = evaluateSlackV1Rails({
  event,
  botUserId: config.slackBotUserId,
  kodiaiChannelId: config.slackKodiaiChannelId,
});

if (rail.decision === "ignore") {
  logger.info({ reason: rail.reason }, "Slack event ignored by v1 rails");
  return c.json({ ok: true });
}

// allowed: contains channel, threadTs, user, text
```

### Anti-Patterns to Avoid
- **Parsing JSON before verification:** breaks signature guarantees and weakens ingress trust.
- **Branchy route logic for rails:** keep policy in pure `safety-rails.ts`, not ad hoc `if` chains in route handler.
- **Using channel names for gating:** enforce by channel ID (`SLACK_KODIAI_CHANNEL_ID`), not `#name` text.
- **Synchronous downstream processing in webhook thread:** risks Slack retries/timeouts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signature compare security | Manual `===` string compare | `timingSafeEqual`-style compare in crypto | Prevent timing side-channel issues |
| Message mention parsing heuristics | Fuzzy regex on display names | Explicit `<@USERID>` token check | Slack canonical mention syntax is ID-based and stable |
| Global policy state machine | Stateful ad hoc logic in route | Pure rail evaluator with reason codes | Easier to test, reason about, and log |
| Realtime processing loop | Blocking logic in webhook handler | Fire-and-fork async seam + fast ack | Slack requires quick 2xx acknowledgements |

**Key insight:** Slack ingress security and v1 behavior control are best done as two strict gates (authenticity gate, policy gate) before any business logic.

## Common Pitfalls

### Pitfall 1: Raw body is altered before HMAC
**What goes wrong:** Signature validation fails intermittently or always.
**Why it happens:** Body is parsed/re-serialized before HMAC base string build.
**How to avoid:** Use the exact incoming body bytes/string for `v0:{timestamp}:{raw_body}`.
**Warning signs:** All requests return `401` despite correct secret.

### Pitfall 2: Timestamp replay window not enforced
**What goes wrong:** Old captured requests can be replayed.
**Why it happens:** Signature checked without age check.
**How to avoid:** Reject if `abs(now - header_ts) > 300` seconds.
**Warning signs:** Valid signature accepted for stale payloads in tests.

### Pitfall 3: Rails key off channel name instead of channel ID
**What goes wrong:** Renames or similarly named channels bypass intended boundary.
**Why it happens:** Comparing `#kodiai` text from message context.
**How to avoid:** Compare `event.channel` to configured `SLACK_KODIAI_CHANNEL_ID`.
**Warning signs:** Events from unexpected channels pass after rename.

### Pitfall 4: Thread-only rule allows root posting path
**What goes wrong:** Bot may post top-level channel messages.
**Why it happens:** Allowed payload lacks explicit thread target.
**How to avoid:** For allowed events, always normalize to `threadTs` and require downstream to use it.
**Warning signs:** Integration code can call publish without thread timestamp.

### Pitfall 5: DM filtering based only on event type
**What goes wrong:** Some non-channel surfaces leak through.
**Why it happens:** Ignoring `channel_type` field on message events.
**How to avoid:** Enforce `channel_type === "channel"` for v1; reject `im`, `mpim`, `app_home`, and non-message event shapes.
**Warning signs:** DM payloads enter processing path.

## Code Examples

Verified patterns from official docs and current codebase:

### 1) Slack signature construction and comparison
```typescript
// Source: https://docs.slack.dev/authentication/verifying-requests-from-slack/
const base = `v0:${timestamp}:${rawBody}`;
const digest = createHmac("sha256", signingSecret).update(base).digest("hex");
const expected = `v0=${digest}`;

// Compare in constant time after length check
const valid = timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
```

### 2) URL verification challenge response
```typescript
// Source: https://docs.slack.dev/apis/events-api/using-http-request-urls/
if (payload.type === "url_verification") {
  return c.json({ challenge: payload.challenge });
}
```

### 3) Mention-only bootstrap token check
```typescript
// Source: https://docs.slack.dev/messaging/formatting-message-text/#mentioning-users
const mentionToken = `<@${botUserId}>`;
const hasBootstrapMention = (event.text ?? "").includes(mentionToken);
```

### 4) Existing Kodiai fire-and-fork webhook pattern
```typescript
// Source: src/routes/webhooks.ts
Promise.resolve()
  .then(() => eventRouter.dispatch(event))
  .catch((err) => childLogger.error({ err, deliveryId }, "Event dispatch failed"));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Verification token trust | Signing secret + HMAC request signing | Slack deprecates token-based trust (documented in current auth guide) | Stronger authenticity and replay defense |
| Synchronous webhook handlers | Immediate 2xx + async processing | Established best practice in Slack Events API docs | Higher reliability under retries/timeouts |
| Name-based mention/channel logic | ID-based mention and channel matching | Current Slack formatting + event schemas | Deterministic policy checks across renames/display changes |

**Deprecated/outdated:**
- Verification-token-only request validation for Events API
- Username-based routing/mention assumptions instead of IDs

## Open Questions

1. **Should v1 ingress subscribe to `app_mention` only, `message.channels`, or both?**
   - What we know: `app_mention` is explicit for mentions; `message` events include `channel_type` and are required for future thread follow-ups.
   - What's unclear: exact subscription plan for Phase 78 handoff.
   - Recommendation: For strict v1 bootstrap, use verified message-event rails keyed on mention token; optionally subscribe to both but gate identically.

2. **Do we need Slack `event_id` deduplication in Phase 77?**
   - What we know: Slack retries on timeout/error; app currently dedups GitHub deliveries but not Slack yet.
   - What's unclear: expected duplicate volume and whether retries will create side effects before Phase 78.
   - Recommendation: Keep out of hard requirements for 77, but leave explicit seam for dedup in next phase.

## Sources

### Primary (HIGH confidence)
- https://docs.slack.dev/authentication/verifying-requests-from-slack/ - signing secret algorithm, replay window guidance, header semantics
- https://docs.slack.dev/apis/events-api/ - 3-second ack guidance, retries, envelope behavior
- https://docs.slack.dev/apis/events-api/using-http-request-urls/ - URL verification challenge flow and response forms
- https://docs.slack.dev/messaging/formatting-message-text/ - canonical mention token syntax `<@USERID>`
- https://raw.githubusercontent.com/slackapi/node-slack-sdk/main/packages/types/src/events/message.ts - `channel_type`, `thread_ts`, subtype shapes
- https://raw.githubusercontent.com/slackapi/node-slack-sdk/main/packages/types/src/events/app.ts - `AppMentionEvent` shape
- `src/routes/webhooks.ts` - Kodiai verify-first and async dispatch pattern
- `src/config.ts` - Kodiai fail-fast env validation pattern

### Secondary (MEDIUM confidence)
- https://docs.slack.dev/tools/node-slack-sdk/reference/types/interfaces/GenericMessageEvent - type documentation mirrors raw source
- https://docs.slack.dev/tools/node-slack-sdk/reference/types/interfaces/AppMentionEvent - type documentation mirrors raw source
- https://docs.slack.dev/reference/methods/chat.postMessage - thread reply semantics (`thread_ts`, `reply_broadcast`)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - uses existing installed stack + official Slack security docs
- Architecture: HIGH - directly aligned to current Kodiai route/config patterns and Slack ack requirements
- Pitfalls: HIGH - derived from official verification flow + known webhook reliability failure modes

**Research date:** 2026-02-17
**Valid until:** 2026-03-19 (30 days)
