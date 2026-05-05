---
phase: milestone-completion
phase_name: Same-PR Formatter Suggestions
project: kodiai
generated: 2026-05-05T05:43:01Z
counts:
  decisions: 5
  lessons: 5
  patterns: 5
  surprises: 3
missing_artifacts:
  - GSD memory store capture_thought persistence failed with `failed to create memory`; LEARNINGS.md remains the cited audit trail.
---

# M066 Learnings

### Decisions

- Deliver formatter fixes as GitHub suggestion blocks in inline Pull Request Review comments on the existing PR, not as a separate PR, branch push, bot-authored commit, issue comment, or standalone comment loop.
  Source: DECISIONS.md/D195
- Generate formatter suggestion content with a deterministic repository-configured formatter command and unified-diff mapping pipeline instead of relying on Jenkins artifacts or Claude-authored hunks.
  Source: DECISIONS.md/D196-D198
- Keep explicit formatter-suggestion requests always available while `review.formatterSuggestions.automatic` defaults false and remains reserved for future automatic-review inclusion.
  Source: DECISIONS.md/D197
- Publish formatter suggestions as one batched same-PR Pull Request Review with multiple inline comments, idempotency markers, and all-or-nothing publisher outcomes.
  Source: DECISIONS.md/D199
- Use one shared `mention-format-suggestions` action identity from mention routing through formatter subflow key generation, completion logs, smoke artifact, and verifier proof.
  Source: S07-SUMMARY.md/Key decisions

### Lessons

- Live proof can fail before GitHub suggestion acceptance: S06 showed the deployed app acknowledged `@kodiai format suggestions` but handled it as generic conversation without formatter subflow fields or review-output identity.
  Source: S06-SUMMARY.md/What Happened
- PR-head formatter configuration is required for controlled smokes when `main` does not contain `review.formatterSuggestions.command`, because Kodiai loads config from the checked-out PR head.
  Source: S06-SUMMARY.md/Key decisions
- The inbound sanitize pipeline strips HTML comments, so formatter publication must preserve idempotency markers with raw secret scanning plus targeted outgoing mention sanitization instead.
  Source: S03-SUMMARY.md/Key decisions
- Verification-first smoke artifacts prevent false greens: S05 and S06 recorded blocked/negative proof rather than fabricating `m066_s05_ok`, and R077/R085 only moved after S07's live verifier passed.
  Source: S05-SUMMARY.md/Deviations
- The local GSD memory store was malformed/unwritable during the milestone, so reusable decisions and gotchas had to be preserved in slice summaries, PROJECT.md, and this LEARNINGS artifact when `capture_thought` failed.
  Source: S07-SUMMARY.md/Known Limitations

### Patterns

- Use a verifier-first operational proof gate for external platform claims: `verify:m066:s05` accepts only a formatter review-output key, exactly one COMMENTED same-PR Pull Request Review, and an associated fenced suggestion review comment.
  Source: S05-SUMMARY.md/Patterns established
- Split formatter suggestions into composable seams: mention-intent parsing, command execution, diff parsing, PR diff commentability indexing, suggestion mapping, orchestration, and publisher each have bounded contracts and targeted tests.
  Source: M066-SUMMARY.md/Narrative
- Treat invalid formatter diff states as structured skip diagnostics instead of partial guesses, and enforce caps after safety validation so generated/skipped/capped counts stay truthful.
  Source: S02-SUMMARY.md/Patterns established
- Keep format-only formatter suggestions read-only and Claude-free while combined review-and-format requests run normal review and formatter subflows independently with separate failure surfaces.
  Source: S04-SUMMARY.md/Patterns established
- Bounded deployed-smoke diagnostics should report trigger classification, formatter command, mapper, publisher, GitHub acceptance, delivery id, and reviewOutputKey separately so the next remediation starts at the first failing boundary.
  Source: S07-SUMMARY.md/Patterns established

### Surprises

- The initial authenticated live trigger reached the deployed app and received a bot acknowledgement, but the deployed runtime still handled it as a generic conversational formatting request rather than explicit formatter intent.
  Source: S06-SUMMARY.md/What Happened
- Current source already handled the plain trigger; the actionable regression target was missing formatter completion evidence (`deliveryId`, `reviewOutputKey`, `reviewOutputAction`) rather than pure phrase classification.
  Source: S07-SUMMARY.md/Deviations
- The Azure Container Apps deploy path hit a transient Azure CLI connection reset during secret-reference update, but the documented idempotent retry completed and produced the active proof revision.
  Source: S07-SUMMARY.md/What Happened
