# T03: 01-webhook-foundation 03

**Slice:** S01 — **Milestone:** M001

## Description

Implement the event handler registry with explicit Map-based routing, bot filtering pipeline, and wire the complete webhook processing flow -- from signature verification through bot filtering to isolated handler dispatch.

Purpose: This completes the Phase 1 goal. After this plan, the webhook foundation is fully functional: events arrive, are verified, deduplicated, filtered for bots, and dispatched to registered handlers with isolated error handling. Phase 2+ handlers can simply register via the event router.
Output: A complete event routing system with `register(eventKey, handler)` and `dispatch(event)`, a bot filter that blocks bot accounts (except those on the allow-list) and always blocks self-events, and the full webhook processing pipeline wired end-to-end.

## Must-Haves

- [ ] "Events are dispatched to registered handlers by event type and action"
- [ ] "Multiple handlers can be registered for the same event type"
- [ ] "One handler's failure does not prevent other handlers from running"
- [ ] "Events from bot accounts are silently dropped before reaching handlers"
- [ ] "The app's own events are always filtered regardless of allow-list"
- [ ] "Bots on the configurable allow-list pass through the filter"
- [ ] "Unhandled event types are silently dropped with no error"
- [ ] "Webhook processing happens asynchronously (200 returned before handlers complete)"

## Files

- `src/webhook/router.ts`
- `src/webhook/filters.ts`
- `src/webhook/types.ts`
- `src/routes/webhooks.ts`
- `src/index.ts`
