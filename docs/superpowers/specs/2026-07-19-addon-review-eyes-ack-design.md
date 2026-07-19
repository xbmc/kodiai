# Add-on Review Eyes Acknowledgement Design

## Problem

An explicit `@kodiai review` comment in a configured add-on repository is routed to the specialized add-on reviewer and the mention handler then stops. The shared eyes-reaction step runs later in the normal mention pipeline, so this early return bypasses the acknowledgement even though the review is accepted and completed.

## Scope

Add one best-effort eyes reaction to accepted explicit add-on review mentions before specialized dispatch. Preserve all existing mention validation, author allow-listing, handle matching, normal mention behavior, specialized review behavior, and canonical review publication.

Rejected or disabled mentions must remain unacknowledged. A specialized add-on review mention must receive exactly one eyes reaction.

## Design

The mention request-preparation boundary will accept an acknowledgement callback supplied by the mention handler. After configuration and request validation establish that the request is an explicit review for a configured add-on repository, request preparation will invoke the callback immediately before awaiting specialized add-on-review dispatch.

The callback will reuse the existing `postMentionEyesReaction` helper and installation Octokit client. Its existing best-effort error handling remains unchanged: a reaction API failure is logged but does not prevent the review.

The normal mention path continues to acknowledge in `runMentionPrePromptGates`; the new callback is invoked only on the specialized route that returns before reaching those gates.

## Data Flow

1. Normalize and validate the mention.
2. Load trusted repository configuration.
3. Confirm an explicit review request in a configured add-on repository.
4. Add the best-effort eyes reaction.
5. Dispatch the synthetic `addon_rule_review.requested` event.
6. Stop the generic mention/review pipeline.

## Testing

Extend the existing mention-handler add-on routing test to record reaction and dispatch order. The regression test must fail before the production change because no reaction occurs. After the fix it must prove:

- one issue-comment eyes reaction is requested;
- the reaction targets the trigger comment;
- acknowledgement happens before specialized dispatch;
- the specialized event is still dispatched once; and
- the generic executor remains unused.

Run the focused mention test, add-on routing tests, lint, the production bundle build, and the full unit suite. Existing baseline failures that reproduce unchanged on the base branch will be reported explicitly.

## Deployment and Verification

Commit the tested fix, deploy that exact commit through `deploy.sh`, and verify that the new Azure revision has 100% traffic, reports the deployed source commit for both app and agent job, and returns healthy liveness/readiness responses.

Live reaction behavior will be verified with a fresh or redelivered explicit add-on review event only when that event is available; deployment health alone will not be presented as proof of the GitHub reaction path.
