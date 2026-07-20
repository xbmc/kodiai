# Explicit Add-on Review Response Design

## Problem

An explicit `@kodiai review` request in a configured add-on repository currently runs the specialized review but updates the PR-wide canonical add-on comment. If that comment predates the request, the result appears above the trigger and looks like no response was posted.

## Goals

- Publish the complete `Summary / Findings / Verdict` result as a new top-level comment after each new explicit add-on review request.
- Keep automatic `pull_request.opened` and `pull_request.synchronize` reviews on the existing PR-wide canonical upsert.
- Make GitHub redelivery of the same explicit request idempotent so it updates its response instead of creating duplicates.
- Preserve the eyes acknowledgement, specialized reviewer, advisory verdict, and generic-review bypass.

GitHub PR conversation comments are not threaded replies, so “response” means a new top-level comment created after the trigger.

## Approaches Considered

### Recommended: delivery-scoped response marker

Use a marker derived from the synthetic explicit-review delivery ID. A new mention has a new delivery ID and therefore creates a fresh review comment; a redelivery has the same ID and updates the same response. Automatic events continue using the existing PR-wide marker.

This gives the expected visible ordering without sacrificing retry idempotency.

### Always create on explicit review

Creating unconditionally is simpler but duplicates full reviews whenever GitHub redelivers a webhook or the service retries publication.

### Keep the canonical comment and post a short link response

This reduces duplication of review text but still separates the request from its actual findings and makes the conversation harder to read. It does not satisfy the request for a visible review response comment.

## Design

The synthetic `addon_rule_review.requested` event already has a stable ID based on the originating GitHub delivery. The add-on handler will select its publication marker by event type:

- explicit `addon_rule_review.requested`: `kodiai:addon-review-request:<synthetic-delivery-id>`;
- automatic pull-request event: existing `kodiai:addon-check:<owner>/<repo>:<pr-number>` marker.

The comment formatter will continue rendering the same concise review body and append the selected marker. The publication helper will accept that selected marker rather than always reconstructing the PR-wide marker internally.

On the first explicit request, no delivery-scoped marker exists, so publication creates a new comment after the trigger. On redelivery or retry of the same request, the marker is found and that response comment is updated. A later explicit request has a different delivery ID and creates another response.

## Error Handling

Comment lookup, creation, and update retain the existing sanitized publication pipeline and result-based error handling. A failed response publication remains a logged non-fatal add-on handler failure; automatic canonical publication behavior is unchanged.

## Testing

Tests will prove:

- an explicit request uses a delivery-scoped marker and creates a fresh comment even when a PR-wide canonical comment already exists;
- replaying the same explicit delivery updates that response rather than creating another comment;
- two distinct explicit deliveries create two distinct response comments;
- automatic opened/synchronize events continue using the PR-wide canonical marker;
- the full response retains `Summary`, `Findings`, and `Verdict`;
- the eyes acknowledgement still occurs before specialized dispatch.

Verification will include focused publication/routing tests, lint, production bundle build, the full unit suite with existing baseline failures reported separately, pinned-commit Azure deployment, and a live explicit add-on review event confirming one eyes reaction plus a new structured response comment after the trigger.
