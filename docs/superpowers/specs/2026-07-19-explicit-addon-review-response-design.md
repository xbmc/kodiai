# Explicit Add-on Review Response Design

## Problem

An explicit `@kodiai review` request in a configured add-on repository currently runs the specialized review but updates the PR-wide canonical add-on comment. If that comment predates the request, the result appears above the trigger and looks like no response was posted.

## Goals

- Publish the complete `Summary / Findings / Verdict` result as a new top-level comment after each new explicit add-on review request.
- Keep automatic `pull_request.opened` and `pull_request.synchronize` reviews on the existing PR-wide canonical upsert.
- Make GitHub redelivery of the same explicit request idempotent so it updates its response instead of creating duplicates.
- Preserve the eyes acknowledgement, specialized reviewer, advisory verdict, and generic-review bypass.
- Avoid marking PR #2861 incomplete when GitHub supplied its 53,089-character changed-file patch by raising the bounded per-file patch limit to 80,000 characters.
- Include a right-side line number on a finding when that line can be validated against an added line in the supplied unified diff.

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

## Evidence Completeness and Finding Locations

The live PR #2861 review marked one patch truncated because `script.module.pyrollbar/lib/rollbar/__init__.py` has a 53,089-character GitHub patch while the local context collector caps each patch at 40,000 characters. GitHub supplied the complete patch; the truncation was introduced by Kodiai. Raising the bounded per-file limit to 80,000 characters keeps this review complete while retaining a hard prompt-size boundary. Patches larger than that limit will continue to produce an explicit incomplete-review caveat rather than silently claiming complete coverage.

`AddonRuleFinding` will gain an optional `line` field. The model prompt will request the new-file/right-side line for line-specific findings. The parser will accept a positive integer only when the finding has a changed path with a supplied patch and that number corresponds to an added line derived from the patch's unified-diff hunk headers. Invalid, unchanged, deleted-side, or unverifiable line numbers will be omitted rather than published.

The formatter will render a validated location as `path:line`. File-level findings, path-only deterministic findings, and findings based on metadata without a usable patch will remain `path`-only.

Complete evidence sets that would form an oversized single model prompt are partitioned on file boundaries into requests containing at most 60,000 patch characters, except when one already-accepted file patch is larger. Up to three chunks run concurrently and their grounded findings are aggregated into the same response. A failed chunk retains findings from successful chunks and marks the model review incomplete instead of discarding useful evidence.

Rules that are explicit and mechanically provable do not depend on model availability. A changed license-like path must be named `LICENSE.txt`, and CRLF on an added text line produces a deterministic `path:line` finding derived from the unified diff's right-side coordinate.

## Error Handling

Comment lookup, creation, and update retain the existing sanitized publication pipeline and result-based error handling. The complete marker-idempotent upsert transaction retries transient GitHub failures so a temporary 5xx response does not permanently lose the review before ingress delivery deduplication takes effect. An exhausted response publication remains a logged non-fatal add-on handler failure; automatic canonical publication behavior is unchanged.

## Testing

Tests will prove:

- an explicit request uses a delivery-scoped marker and creates a fresh comment even when a PR-wide canonical comment already exists;
- replaying the same explicit delivery updates that response rather than creating another comment;
- two distinct explicit deliveries create two distinct response comments;
- automatic opened/synchronize events continue using the PR-wide canonical marker;
- the full response retains `Summary`, `Findings`, and `Verdict`;
- the eyes acknowledgement still occurs before specialized dispatch;
- a 53,089-character patch is retained without a truncation reason while a patch over 80,000 characters remains bounded and marked truncated;
- an LLM-provided line is retained only for an added right-side diff line;
- invalid or unverifiable lines are omitted;
- the formatter renders validated locations as `path:line` and preserves path-only findings.

Verification will include focused publication/routing tests, lint, production bundle build, the full unit suite with existing baseline failures reported separately, pinned-commit Azure deployment, and a live explicit add-on review event confirming one eyes reaction plus a new structured response comment after the trigger.
