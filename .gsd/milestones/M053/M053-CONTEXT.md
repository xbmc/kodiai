# M053: Same-PR Formatter Suggestions

**Gathered:** 2026-05-04
**Status:** Ready for planning

## Project Description

Kodiai will generate committable GitHub formatting suggestions on the same pull request when a maintainer explicitly asks for them, and later when a repository opts into automatic formatter suggestions. The feature is inspired by a `jenkins4kodi` formatter-diff comment on `xbmc/xbmc#28259`, but Kodiai must not consume Jenkins artifacts. Kodiai owns the formatter execution, unified-diff parsing, suggestion mapping, and same-PR review publication loop.

The user emphasized that this must not create another PR and must not push formatting commits. The output stays inside the current GitHub PR as suggested changes that a human can choose to commit through GitHub's native UI.

## Why This Milestone

Formatter diffs are useful but today can land as external `.diff` artifacts that authors must manually inspect and apply. Kodiai already reviews PRs and already knows how to publish inline review comments. This milestone turns formatting fixes into GitHub-native, committable suggestions without relying on Jenkins and without changing normal review behavior by default.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Comment `@kodiai format suggestions` or `@kodiai suggest formatting fixes` on a PR and get same-PR GitHub suggested changes when the configured formatter produces safe hunks.
- Comment `@kodiai review & format suggestions` and get the normal Kodiai review plus formatter suggestions from one request.
- Leave automatic formatter suggestions off by default while still being able to request the feature explicitly.

### Entry point / environment

- Entry point: GitHub PR mention comments handled by `src/handlers/mention.ts`.
- Environment: production Kodiai webhook + Azure Container App agent workspace + GitHub Pull Request Review API.
- Live dependencies involved: GitHub API, PR workspace checkout, configured formatter command, formatter binary availability in the execution environment.

## Completion Class

- Contract complete means: config, mention intent, formatter command execution, unified-diff parsing, suggestion mapping, caps/skips, and batched review publication are covered by deterministic tests and fixtures.
- Integration complete means: explicit mention orchestration can invoke formatter suggestions and combined review+formatter subflows without the two subflows blocking each other.
- Operational complete means: a deployed live smoke proves GitHub accepts at least one Kodiai-generated same-PR formatter suggestion as a committable suggestion.

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- `@kodiai format suggestions` posts a same-PR batched review with at least one valid GitHub suggestion block when the formatter command produces a safe diff.
- `@kodiai review & format suggestions` runs the normal review and formatter suggestion subflow independently from one mention.
- GitHub renders a Kodiai-generated formatter suggestion as a committable suggested change in a live PR; this cannot be considered truly done from fixture tests alone.

## Architectural Decisions

### Formatter suggestions are same-PR review suggestions, not bot commits

**Decision:** Kodiai posts formatter fixes as GitHub suggestion blocks in inline review comments on the existing PR.

**Rationale:** The user explicitly does not want another PR or bot-pushed formatting commits. Same-PR suggestions preserve human control: maintainers or authors decide whether to apply GitHub's “Commit suggestion” flow.

**Alternatives Considered:**
- Create a formatter-fix PR — rejected because the user wants suggestions to stay in the same PR.
- Push directly to the contributor branch — rejected because it mutates contributor code without the GitHub suggestion approval step.

### Jenkins is example evidence only

**Decision:** Kodiai computes formatter suggestions independently from the PR workspace and never consumes `jenkins4kodi` diff artifacts for this capability.

**Rationale:** The Jenkins comment on `xbmc/xbmc#28259` demonstrated the desired formatter-diff outcome, but the user explicitly said they do not want to rely on Jenkins.

**Alternatives Considered:**
- Fetch Jenkins artifact links from comments — rejected as an external dependency and trust/availability problem.

### Explicit requests are always accessible; automatic mode is config-gated

**Decision:** Formatter suggestions are always available by explicit mention. Repo config controls automatic inclusion during normal reviews, defaulting off.

**Rationale:** The user corrected the feature model: “always have it enabled (but only runs when requested unless automatically enabled).” Config should therefore use semantics like `automatic: false`, not `enabled: false`.

**Alternatives Considered:**
- Feature-disabled-by-default config — rejected because it would block explicit requests.

### Deterministic diff-to-suggestion conversion

**Decision:** Formatter output drives suggestion content mechanically: configured command → unified diff → mapped GitHub suggestion payloads.

**Rationale:** GitHub suggestions must replace exact line ranges. Claude should not invent or repair formatting hunks because that would create invalid or misleading committable suggestions.

**Alternatives Considered:**
- Prompt Claude to read a formatter diff and author suggestion blocks — rejected as too error-prone for mechanical formatting.

### Batched PR review publication

**Decision:** Formatter suggestions should publish as one batched Pull Request Review containing multiple inline comments where GitHub accepts the batch.

**Rationale:** The user wants “just one with a bunch of inline suggestions” and wants to avoid noisy standalone comments. The existing single-comment MCP tool is useful prior art but not the ideal publication shape for this feature.

**Alternatives Considered:**
- Loop over `pulls.createReviewComment` — simpler but noisier and does not satisfy the one-review preference.

## Error Handling Strategy

Explicit formatter requests are always recognized. If no formatter command is configured, Kodiai replies with setup-needed guidance rather than saying the feature is disabled. Empty formatter output produces no suggestion review and a concise no-op response. Formatter command failures produce a concise failure surface with sanitized details.

Unified-diff hunks are handled conservatively: invalid, deleted-only, binary, huge, or unmappable hunks are skipped rather than guessed. Only hunks that map cleanly to a valid PR diff line/range become GitHub suggestion blocks. Suggestion count caps are enforced. Partial success posts valid suggestions and records skipped counts/reasons.

For `@kodiai review & format suggestions`, normal review and formatter suggestions are independent subflows. Formatter failure must not block a successful normal review; normal review failure must not block formatter suggestions when those can run safely. Logs and visible outcomes should distinguish review result, formatter result, and combined-request result.

## Risks and Unknowns

- GitHub suggestion mapping — GitHub rejects comments when line/range/side do not match the PR diff, so mapping must be proven with fixtures and live smoke.
- Formatter command availability — the configured formatter binary may not exist in the runtime image or may need repo-specific setup.
- Suggestion spam — formatter diffs can be large, so caps and skip summaries must prevent flooding PRs.
- Combined-mode independence — the orchestrator must avoid one subflow suppressing the other.
- Idempotency — repeated explicit formatter requests must not duplicate the same suggestion review without clear marker handling.

## Existing Codebase / Prior Art

- `src/handlers/mention.ts` — routes explicit PR mentions and should detect formatter-suggestion intents plus combined review+format requests.
- `src/handlers/review.ts` — normal PR review orchestration and publication behavior that combined mode must preserve.
- `src/execution/config.ts` — `.kodiai.yml` review config schema; should add `review.formatterSuggestions.automatic`, command, and cap fields.
- `src/execution/mcp/inline-review-server.ts` — existing single inline-comment MCP server already documents GitHub suggestion block syntax and uses review-output markers.
- `src/execution/review-prompt.ts` — existing prompt already tells Claude how to write suggestion blocks when it has a concrete fix; formatter suggestions should be deterministic and not prompt-only.
- `src/handlers/review-idempotency.ts` — marker and publication gate patterns for avoiding duplicate review output.

## Relevant Requirements

- R076 — explicit formatter suggestion requests.
- R077 — same-PR committable suggestions.
- R078 — repo-configured formatter command.
- R079 — automatic inclusion default off while explicit requests stay available.
- R080 — combined review and formatter request.
- R081 — batched review publication.
- R082 — safe diff-to-suggestion mapping.
- R083 — spam and unsafe-hunk controls.
- R084 — independent failure visibility for combined subflows.
- R085 — live GitHub smoke proof.

## Scope

### In Scope

- Explicit formatter-suggestion mention routing.
- `.kodiai.yml` config for formatter command, automatic mode, and suggestion cap.
- Configured formatter command execution in the PR workspace.
- Unified diff parsing and safe GitHub suggestion payload generation.
- Batched same-PR Pull Request Review publication.
- Combined `@kodiai review & format suggestions` orchestration.
- Strict deterministic tests and live smoke proof.

### Out of Scope / Non-Goals

- Consuming `jenkins4kodi` diff artifacts.
- Creating separate formatter-fix PRs.
- Pushing formatting commits directly to contributor branches.
- Shipping multiple full formatter adapters beyond the first command seam.
- Adding a dry-run preview workflow in the first version.

## Technical Constraints

- Suggestion blocks must replace the exact commented line/range; invalid mappings must be skipped.
- Automatic formatter suggestions must default off.
- Explicit formatter requests must remain available even when automatic mode is false.
- Formatter output publication must be capped.
- Outgoing text must continue through existing mention sanitization and secret scanning paths.
- Live proof is required because GitHub suggestion acceptance cannot be fully simulated.

## Integration Points

- GitHub PR comments — mention entry point.
- GitHub Pull Request Review API — batched inline suggestion publication.
- Azure Container App execution workspace — formatter command runs against PR checkout.
- `.kodiai.yml` — formatter-suggestion command and automatic-mode config.
- Existing review idempotency markers — avoid duplicate formatter suggestion reviews.

## Testing Requirements

Unit and fixture tests must cover config parsing/defaults, explicit and combined mention intent, formatter command placeholder substitution, command errors, empty output, unified diff parsing, suggestion mapping, unsafe hunk skips, max suggestion caps, batched review payload shape, idempotency markers, and combined-mode independent failures. A live smoke proof must demonstrate at least one GitHub-accepted committable suggestion on a real/test PR after deploy.

## Acceptance Criteria

- S01: Config and mention tests prove explicit formatter requests are recognized and automatic mode defaults off without blocking explicit access.
- S02: Fixture tests prove formatter unified diffs become safe suggestion payloads and unsafe hunks are skipped/capped.
- S03: Publisher tests prove one batched PR review can contain multiple inline suggestion blocks with markers/idempotency and failure handling.
- S04: Orchestration tests prove format-only and review+format requests run the correct subflows and preserve independent success/failure behavior.
- S05: Live proof shows GitHub renders a Kodiai-generated formatter suggestion as committable, and docs explain how to request the feature and later opt into automatic mode.

## Open Questions

- Exact config field names — current planning prefers `review.formatterSuggestions.automatic`, `command`, and `maxSuggestions`.
- First live smoke target — choose a controlled test or real PR with a small formatter diff during execution.
