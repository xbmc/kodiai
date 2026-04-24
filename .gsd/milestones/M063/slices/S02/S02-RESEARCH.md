# S02 Research — One evolving review surface with explicit revisions

## Summary

S02 owns the public-surface contract for **R063** (same visible review surface, no extra lifecycle comment) and **R065** (explicit revision of findings). It also supports **R062** by making automatic continuation feel like one review rather than a second workflow artifact.

S01 already extracted continuation planning/settlement into `src/lib/review-continuation-lifecycle.ts`. The remaining gap is almost entirely in **publication ownership and formatting**:

- `src/handlers/review.ts` still publishes a **bounded first-pass issue comment** and a separate **Review Details issue comment** on timeout/continuation paths.
- Retry merge updates both artifacts independently.
- `src/lib/delta-classifier.ts` already computes `new` / `still-open` / `resolved`, but those semantics are only logged and never shown on the visible review surface.

So S02 is not inventing continuation logic. It is defining **which existing comment becomes canonical**, how Review Details is embedded/refreshed on that surface, and how continuation-visible revisions are rendered explicitly instead of silently rewriting the prior narrative.

## Recommendation

Build S02 around the **bounded first-pass comment as the canonical public surface** for continuation paths.

Why this is the smallest safe move:

1. Timeout/continuation already creates that comment first in `src/handlers/review.ts:4830+`.
2. The partial comment already carries the user-facing bounded-first-pass story via `src/lib/partial-review-formatter.ts`.
3. `appendReviewDetailsToSummary(...)` in `src/handlers/review.ts:672+` already knows how to nest/replace a Review Details block inside a summary comment.
4. Using that helper for the timeout/continuation path removes the extra standalone lifecycle comment without redesigning normal full-review publication.

Then layer explicit revision semantics onto the same surface by reusing existing delta machinery:

- compute/display a compact continuation revision section on the canonical comment
- show what is **new**, what remains **still open**, and what is now **resolved/revised**
- keep no-delta continuation quiet: settle internally, do not add public churn

## Implementation Landscape

### Files that matter

- `src/handlers/review.ts`
  - Owns timeout publication, retry enqueue, retry merge, and current Review Details publication/update flow.
  - Key hotspots:
    - `upsertReviewDetailsComment(...)` at `src/handlers/review.ts:651`
    - `appendReviewDetailsToSummary(...)` at `src/handlers/review.ts:672`
    - timeout bounded first-pass publication at `src/handlers/review.ts:4830+`
    - timeout Review Details standalone publication at `src/handlers/review.ts:4887+`
    - retry merge partial comment update at `src/handlers/review.ts:5287+`
    - retry merge Review Details standalone refresh at `src/handlers/review.ts:5325+`
- `src/lib/partial-review-formatter.ts`
  - Formats the bounded first-pass comment body.
  - Currently supports initial bounded summary, retry-complete note, and retry-skipped note.
  - No explicit revision section yet.
- `src/lib/review-utils.ts`
  - Builds Review Details body and marker via `formatReviewDetailsSummary(...)` / `buildReviewDetailsMarker(...)`.
  - Today it exposes bounded-state truth, but no visible continuation revision/change summary.
- `src/lib/delta-classifier.ts`
  - Already classifies findings as `new`, `still-open`, `resolved`.
  - Natural seam for explicit revision wording required by R065.
- `src/handlers/review-idempotency.ts`
  - Preserves the identity boundary: internal retry keys vary, visible identity stays anchored to base `reviewOutputKey`.
- `src/knowledge/types.ts`
  - `CheckpointRecord` stores only `filesReviewed`, `findingCount`, `summaryDraft`, `totalFiles`, `partialCommentId`.
  - Important limitation: no finding-level continuation history is persisted here.
- `scripts/verify-m062-s03.ts`
  - Existing parity proof between bounded comment and Review Details wording; best foundation for a new S02 verifier.
- `src/handlers/review.test.ts`
  - Already has end-to-end timeout/continuation merge tests proving both surfaces update today.

### What exists vs what is missing

#### Exists

- A canonical continuation lifecycle seam from S01 (`src/lib/review-continuation-lifecycle.ts`).
- A bounded first-pass public comment formatter.
- A Review Details formatter and marker.
- A helper that can replace nested Review Details inside an existing summary comment.
- Delta classification for findings.
- Authority-safe last-mile publish gating during retry merge.

#### Missing

- A single declared owner for the public continuation surface.
- Explicit user-visible revision wording using delta results.
- Quiet no-delta behavior on the visible surface beyond “keep original partial review”.
- Proof that continuation no longer creates an extra lifecycle comment.

## Natural Seams for Planning

### Seam 1 — Canonical comment ownership

The highest-value first task is to make timeout/continuation use **one canonical comment**.

Concretely:

- publish the bounded first-pass comment
- append/update Review Details **inside that same comment** using `appendReviewDetailsToSummary(...)`
- stop creating/updating a second standalone Review Details issue comment for this path

This is the direct R063 delivery seam.

### Seam 2 — Visible revision rendering

After same-surface ownership is stable, add a formatter seam for continuation revisions.

Likely options:

- extend `formatPartialReviewComment(...)` with a continuation revision block, or
- add a small helper in `src/lib/` that formats revision summary lines and injects them into the partial comment

The existing delta classifier is the obvious source of truth. No need to invent a second “revision” model first.

### Seam 3 — Deterministic proof

After the formatter/output contract is stable, add deterministic verification proving:

- only one visible lifecycle comment exists for the continuation path
- retry merge revises that same surface in place
- revision wording is explicit for changed findings
- no-delta continuation does not create noisy public churn

This should probably mirror the style of `scripts/verify-m062-s03.ts` and `scripts/verify-m063-s01.ts`.

## Key Findings and Constraints

### 1. The current timeout path still creates two visible artifacts

In `src/handlers/review.ts:4830+`, timeout publishes the bounded first-pass comment with `formatPartialReviewComment(...)`.

Then in `src/handlers/review.ts:4887+`, it separately calls `upsertReviewDetailsComment(...)` to publish Review Details as its own issue comment.

That directly conflicts with the slice goal if interpreted strictly: continuation currently deepens **two** visible issue comments, not one.

### 2. The codebase already has the helper needed to collapse to one surface

`appendReviewDetailsToSummary(...)` in `src/handlers/review.ts:672+`:

- finds the existing summary comment by `reviewOutputKey` marker
- injects/replaces a nested `<details><summary>Review Details</summary>` block
- is already idempotent about replacing an existing Review Details block

This is the lowest-risk path to same-surface continuation behavior.

### 3. The bounded first-pass timeout comment may need a stable marker if it becomes the canonical surface

`appendReviewDetailsToSummary(...)` looks up the summary comment by `buildReviewOutputMarker(reviewOutputKey)`.

But the timeout bounded first-pass path at `src/handlers/review.ts:4830+` creates the issue comment from `formatPartialReviewComment(...)` and does **not** append a `reviewOutputKey` marker there.

Implication: if S02 wants to reuse `appendReviewDetailsToSummary(...)` for timeout/continuation, the bounded first-pass comment needs a stable way to be rediscovered later. That likely means adding the base review-output marker to the canonical comment body or otherwise teaching the updater to target the stored `partialCommentId`.

Planner note: marker-based rediscovery is more robust than relying only on checkpoint state.

### 4. Retry merge already updates both surfaces; S02 should delete duplication, not add more branches

On retry success, `src/handlers/review.ts:5287+` rebuilds the partial comment and updates it in place. Then `src/handlers/review.ts:5325+` refreshes Review Details separately.

S02 should preserve that overall orchestration but collapse it to a single public surface update contract. Do not fork a separate “same-surface continuation” branch; replace the duplicate publication path.

### 5. Delta classification already exists but is not surfaced to the user

`src/lib/delta-classifier.ts` produces:

- current findings annotated as `new` or `still-open`
- prior-only findings listed as `resolved`
- aggregate counts

`src/handlers/review.ts:4030+` computes this as `deltaClassification`, but it is only used for logs/telemetry (`deltaNew`, `deltaResolved`, `deltaStillOpen` at `src/handlers/review.ts:4143+`).

This is the most obvious seam for R065. The product requirement does not need a new algorithm; it needs this existing classification to become visible and legible on the same review surface.

### 6. Checkpoint state is too thin for rich finding-history rendering

`CheckpointRecord` in `src/knowledge/types.ts` stores only coarse progress and `partialCommentId`. It does **not** store finding-level prior state for continuation.

That means explicit revision rendering should prefer existing already-available sources like:

- `deltaClassification` from prior findings vs current findings, or
- the already-merged summary draft produced during continuation

Avoid expanding checkpoint schema in S02 unless necessary. That smells like S03/M064 scope.

### 7. No-delta continuation is already conceptually supported

`settleReviewContinuation(...)` in `src/lib/review-continuation-lifecycle.ts` returns `settle-without-update` for no-new-results. The handler already logs “keeping original partial review”.

So the lifecycle contract for quiet settlement exists. S02 mainly needs to ensure public-surface code does not accidentally append revision/status noise in that case.

## Verification Strategy

Use the rules from the loaded superpowers skillset indirectly here: **evidence before claims** and verify the real publication path, not just formatter units.

### Unit / focused tests

- `bun test src/lib/partial-review-formatter.test.ts`
  - extend for explicit revision wording and no-delta quiet behavior
- `bun test src/lib/review-utils.test.ts`
  - extend if Review Details gains continuation revision summary text

### Handler integration tests

- `bun test src/handlers/review.test.ts --filter "continuation"`
  - verify timeout creates one canonical visible lifecycle comment for continuation paths
  - verify retry merge updates that same surface in place
  - verify no extra standalone Review Details comment appears
  - verify no-delta continuation preserves the original visible surface without churn

### Deterministic verifier

Add an S02 verifier, likely `scripts/verify-m063-s02.ts`, modeled after `scripts/verify-m062-s03.ts`.

Minimum proof matrix:

1. bounded first pass → one visible lifecycle surface only
2. retry merge → same surface updated, not extra comment
3. explicit revisions visible (`new` / `still-open` / `resolved` or equivalent wording)
4. no-delta continuation → lifecycle settles without extra public update
5. base `reviewOutputKey` remains the public identity even when internal pass key is `-retry-1`

## Risks

- **Marker gap on the bounded first-pass comment**: same-surface update will be brittle unless the canonical comment is rediscoverable by base `reviewOutputKey`.
- **Silent rewrites**: if delta classification is computed but only used to rewrite summary text, S02 will miss R065’s “explicit revisions” requirement.
- **Accidental lifecycle chatter**: adding a “continuation settled” note on every no-delta pass would violate the slice’s quiet-settlement intent.
- **Over-scoping into persistence**: finding-history durability is a later concern; S02 should first ship same-surface ownership using already-available delta inputs.

## Skill Discovery (suggest)

Directly relevant technology here is the internal TypeScript/Bun + GitHub PR publication stack already in the repo. The only installed adjacent skill is `github-bot`, but this slice does not require GitHub API operations outside the existing code’s own publication path, so no extra skill installation is necessary for planning this slice.
