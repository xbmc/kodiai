# M066: Same-PR Formatter Suggestions

**Vision:** Kodiai should independently compute formatter changes for a pull request and publish them as same-PR GitHub committable suggestions when explicitly requested, with automatic inclusion defaulting off but available by repo config.

## Success Criteria

- Maintainers can explicitly request formatter suggestions on a PR without enabling automatic mode.
- Kodiai computes formatter suggestions independently of Jenkins artifacts.
- Formatter suggestions appear as same-PR GitHub committable suggested changes, not a new PR or bot-pushed commit.
- A combined `@kodiai review & format suggestions` request runs both subflows with independent failure handling.
- Unsafe or excessive formatter hunks are skipped/capped with visible and logged reasons.
- A live deployed smoke proves GitHub accepts at least one Kodiai-generated formatter suggestion.

## Slices

- [ ] **S01: S01** `risk:medium` `depends:[]`
  > After this: `@kodiai format suggestions` and `@kodiai review & format suggestions` are recognized, and config shows automatic suggestions default off while explicit requests stay allowed.

- [ ] **S02: Formatter command and diff-to-suggestion mapper** `risk:high` `depends:[S01]`
  > After this: Fixture tests prove formatter unified diffs become safe GitHub suggestion payloads, with unmappable hunks skipped and capped.

- [ ] **S03: Batched same-PR suggestion review publisher** `risk:high` `depends:[S02]`
  > After this: A publisher can create one GitHub PR review containing multiple inline suggestion blocks, with markers/idempotency and rejection handling.

- [ ] **S04: Explicit and combined request orchestration** `risk:medium` `depends:[S01,S02,S03]`
  > After this: `@kodiai format suggestions` runs only formatter suggestions, while `@kodiai review & format suggestions` runs normal review plus formatter suggestions without either subflow blocking the other.

- [ ] **S05: Live smoke proof and operator docs** `risk:medium` `depends:[S04]`
  > After this: A deployed run posts at least one committable formatter suggestion on a real/test PR and documents how maintainers enable automatic mode later.

## Boundary Map

## Boundary Map

### S01 → S02
Produces:
- `review.formatterSuggestions` config shape with `automatic`, `command`, and `maxSuggestions` semantics.
- Mention intent contract for `format suggestions`, `suggest formatting fixes`, and `review & format suggestions`.
- Formatter request descriptor passed from mention routing into formatter execution.

Consumes:
- Existing `.kodiai.yml` config schema and mention routing patterns.

### S02 → S03
Produces:
- Formatter command runner result shape: stdout unified diff, exit status, stderr summary, no-op status.
- Parsed formatter hunk model with file path, old/new ranges, replacement text, and skip reasons.
- Safe GitHub suggestion payload model with path, line/startLine/side, suggestion body, and source hunk metadata.

Consumes from S01:
- Configured formatter command and max suggestion cap.
- Explicit formatter request descriptor.

### S03 → S04
Produces:
- Batched formatter suggestion publisher that creates one Pull Request Review with multiple inline suggestion comments.
- Publication result shape: posted/skipped/failed counts, review URL/id, skip reasons, and idempotency marker status.
- Failure surface for whole-batch GitHub rejection.

Consumes from S02:
- Safe suggestion payloads and skipped hunk diagnostics.

### S04 → S05
Produces:
- End-to-end explicit format-only orchestration.
- End-to-end combined review+formatter orchestration with independent subflow results.
- Structured logs/result fields distinguishing normal review, formatter suggestion, and combined-request outcomes.

Consumes from S01:
- Mention intent and config semantics.
Consumes from S02:
- Formatter command/diff/suggestion mapping pipeline.
Consumes from S03:
- Batched same-PR suggestion publisher.

### S05 Final Integration
Produces:
- Operator documentation/runbook for formatter suggestions.
- Live proof artifact links showing GitHub accepted at least one Kodiai-generated committable suggestion.
- Milestone verifier or smoke script evidence for the full path.

Consumes from S04:
- Working explicit and combined request flows.
