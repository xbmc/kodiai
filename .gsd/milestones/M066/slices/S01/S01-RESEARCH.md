# S01 Research — Formatter suggestion config and mention intent

## Summary

S01 is a targeted codebase extension, not a new external integration yet. The work should add:

- A nested `.kodiai.yml` config shape at `review.formatterSuggestions` with `automatic`, `command`, and `maxSuggestions`.
- A pure mention-intent parser for explicit formatter-suggestion requests.
- Mention-handler wiring that recognizes format-only and combined review+format requests without enabling write mode or depending on automatic config.
- Tests proving defaults, configured values, explicit access while `automatic: false`, and combined intent classification.

Owned/supporting requirements for this slice:

- **Owns R076** — recognize explicit `@kodiai format suggestions` / `@kodiai suggest formatting fixes` PR mentions.
- **Owns R079** — automatic formatter suggestions default off while explicit requests stay available.
- **Supports R078** — establishes the configured formatter command field consumed by S02.
- **Supports R080** — recognizes `@kodiai review & format suggestions`; S04 will execute both subflows.
- **Supports R083** — establishes `maxSuggestions` cap config consumed by S02/S03.

Memory lookup was attempted with `memory_query("formatter suggestions mention config kodiai review.formatterSuggestions mention routing")`, but the GSD memory DB returned `database disk image is malformed`; no prior memory was available.

## Recommendation

Implement S01 in two small seams:

1. **Config schema seam** in `src/execution/config.ts` and `src/execution/config.test.ts`.
   - Add `formatterSuggestionsSchema` nested under `reviewSchema`.
   - Recommended defaults:
     - `automatic: false`
     - `command: undefined` (or optional string)
     - `maxSuggestions: 10` with a bounded range, e.g. `1..100`.
   - Do not use `enabled`; milestone decision D197 requires explicit requests to remain available even when automatic mode is off.

2. **Mention intent seam** as a pure parser, ideally new file `src/handlers/formatter-suggestion-intent.ts` with colocated tests.
   - Export a descriptor type usable by later slices, e.g.:

     ```ts
     export type FormatterSuggestionRequest = {
       requested: true;
       mode: "format-only" | "review-and-format";
       source: "explicit-mention";
       normalizedRequest: string;
     };
     ```

   - Export `detectFormatterSuggestionRequest(userQuestion: string): FormatterSuggestionRequest | undefined`.
   - Export/centralize combined review detection so `review & format suggestions` is not only classified by the existing `isReviewRequest()` prefix match.

Wire this parser into `src/handlers/mention.ts` after `stripMention(...)` and before write-intent classification. The immediate S01 handler contract can be an added optional `formatterSuggestionRequest` on `ExecutionContext` so tests can prove mention routing produces a descriptor without forcing S02/S04 execution yet. For format-only requests, ensure `writeMode` is not true. For combined requests, preserve existing explicit-review behavior (`taskType` review lane, review output key, inline tools) while carrying the formatter descriptor for later orchestration.

## Implementation Landscape

### `src/execution/config.ts`

Current structure:

- Uses Zod schemas with defaults and a two-pass `loadRepoConfig(workspaceDir)` strategy.
- `reviewSchema` already owns review settings such as `enabled`, `triggers`, `autoApprove`, `prompt`, `maxComments`, `suppressions`, `minConfidence`, `pathInstructions`, `profile`, and `outputLanguage`.
- `RepoConfig` is inferred from `repoConfigSchema`, so adding a nested review field updates the project type automatically.
- Unknown keys are stripped by default and tested.
- If the entire `review` block fails validation in fallback mode, `reviewSchema.parse({})` is used, so formatter config invalidity will currently reset the whole review section unless a more granular fallback is introduced. S01 likely does not need a custom nested fallback unless preserving partially valid review config with invalid formatter config becomes a requirement.

Natural config patch:

```ts
const formatterSuggestionsSchema = z
  .object({
    automatic: z.boolean().default(false),
    command: z.string().min(1).optional(),
    maxSuggestions: z.number().min(1).max(100).default(10),
  })
  .default({ automatic: false, maxSuggestions: 10 });

const reviewSchema = z.object({
  // existing fields...
  formatterSuggestions: formatterSuggestionsSchema,
});
```

Add default object entries in the `reviewSchema.default(...)` object too. Tests should assert `config.review.formatterSuggestions.automatic === false` when no config exists and when `review:` exists without `formatterSuggestions:`.

### `src/execution/config.test.ts`

Existing config tests are broad and already cover:

- no `.kodiai.yml` defaults,
- parsing nested `review.triggers`,
- stripping unknown nested review keys,
- invalid-section fallback,
- mention admission defaults.

Add focused tests near the review tests:

- `defaults formatter suggestions automatic off and explicit-cap config present`.
- `parses review.formatterSuggestions from YAML` with all fields.
- `review.formatterSuggestions can set automatic true`.
- `review.formatterSuggestions.command` is optional so explicit format requests can be recognized before setup.
- `invalid formatterSuggestions values fall back through review warning` if keeping current section fallback behavior.

### `src/handlers/mention.ts`

Current explicit review path:

- `stripMention()` removes `@kodiai`, `@kodai`, and optionally `@claude` from the comment body.
- `isReviewRequest(userQuestion)` is a local helper around line ~1081. It recognizes direct review requests and PR-update shorthand such as `better now?`.
- Before enqueuing, the handler calculates `isExplicitReviewRequest` from the provisional stripped body. Explicit review requests claim a `ReviewWorkCoordinator` attempt and enqueue with lane `interactive-review`; all other mentions enqueue with lane `sync`.
- Inside the job, the handler reloads config, computes accepted handles, re-strips the mention, recomputes `explicitReviewRequest`, then runs write-intent detection.
- Write-intent guard currently checks `!isReviewRequest(parsedWriteIntent.request)` before broad PR patch detection. Formatter-intent detection should join this guard so format-only requests do not accidentally become write requests in future wording variants.
- Executor invocation currently passes `taskType`, `triggerBody`, `prompt`, `reviewOutputKey`, `writeMode`, etc. `ExecutionContext` in `src/execution/types.ts` will need an optional formatter-request field if S01 chooses to carry a descriptor through the existing executor context.

Important behavior from current code:

- `@kodiai review & format suggestions` probably already matches `isReviewRequest()` because it starts with `review`, but that loses the formatter half. Add explicit combined detection rather than relying on the prefix.
- `@kodiai format suggestions` and `@kodiai suggest formatting fixes` do not match the existing review or write-intent helpers and are currently treated as normal conversational mentions.
- The handler has a fast substring filter for `@kodiai`, `@kodai`, or `@claude`; formatter intent does not need to change this.
- Alias behavior matters: `@claude format suggestions` should probably work while `mention.acceptClaudeAlias` is true, consistent with existing explicit review mentions. Tests should cover at least canonical `@kodiai`; alias can be a small extra if cheap.

Recommended parser semantics:

- Format-only:
  - `format suggestions`
  - `formatting suggestions`
  - `suggest formatting fixes`
  - `suggest formatting changes`
  - optional polite prefixes: `please`, `can/could/would/will you please ...`
- Combined review+format:
  - `review & format suggestions`
  - `review and format suggestions`
  - `review + format suggestions`
  - possibly `review with format suggestions`
- Stay conservative. Do not match broad `format this PR` as write mode in S01 unless the exact product wording needs it; the requirement examples are suggestion-oriented.

### `src/handlers/mention.test.ts`

Existing mention tests use full handler fixtures and assertions around executor context. Useful patterns:

- `@kodiai review uses review task type and review output key` around line ~10552 captures `taskType`, `reviewOutputKey`, `triggerBody`, `prompt`, `maxTurnsOverride`, `enableInlineTools`.
- `review requests on PR surfaces never trigger write mode` around line ~1625 is the right regression pattern for proving format requests do not trigger write mode.
- The test helper `createWorkspaceFixture(...)` writes `.kodiai.yml` content into a git workspace and supports PR issue-comment events.

Add S01 handler tests that capture executor context:

- `@kodiai format suggestions carries formatterSuggestionRequest and stays read-only`.
  - Config should set `review.formatterSuggestions.automatic: false` and a dummy command.
  - Assert `ctx.formatterSuggestionRequest.mode === "format-only"` and `ctx.writeMode !== true`.
  - Assert no `reviewOutputKey` unless S01 intentionally creates a formatter-specific key (probably defer idempotency to S03).
- `@kodiai suggest formatting fixes works when automatic is false and command is absent`.
  - Proves explicit recognition is not blocked by config setup; later slices can reply setup-needed.
- `@kodiai review & format suggestions preserves explicit review context and carries formatter descriptor`.
  - Assert `taskType` remains a review task, `reviewOutputKey` exists, `enableInlineTools === true`, `formatterSuggestionRequest.mode === "review-and-format"`.
- Add a direct pure-parser test file if the parser is extracted; this will keep phrase coverage cheap without more full handler fixture cost.

### `src/execution/types.ts`

If carrying the descriptor through `executor.execute(...)`, add an optional field to `ExecutionContext`:

```ts
formatterSuggestionRequest?: FormatterSuggestionRequest;
```

Import only a lightweight type from the new parser/types module to avoid creating a runtime cycle. This field can be ignored by `src/execution/executor.ts` until S04, but TypeScript needs the property for `mention.ts` to compile.

### `docs/configuration.md`

S05 owns operator docs, but S01 can optionally add a small config-reference entry if "config shows automatic suggestions default off" is interpreted as documentation, not just tests. If docs are deferred, make the S01 plan explicit that proof is via config tests and `RepoConfig` shape. If docs are included now, add a concise `review.formatterSuggestions` section and update the quick-start example only if desired.

## Natural Task Breakdown for Planner

1. **Config defaults and parsing**
   - Files: `src/execution/config.ts`, `src/execution/config.test.ts`.
   - Verify: `bun test ./src/execution/config.test.ts --timeout 30000`.

2. **Pure mention formatter intent parser**
   - Files: new `src/handlers/formatter-suggestion-intent.ts`, new `src/handlers/formatter-suggestion-intent.test.ts`.
   - Verify phrase matrix directly with Bun tests.

3. **Mention-handler wiring and descriptor propagation**
   - Files: `src/handlers/mention.ts`, `src/execution/types.ts`, `src/handlers/mention.test.ts`.
   - Verify: `bun test ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000`.

4. **Optional config docs**
   - File: `docs/configuration.md`.
   - Verify referenced fields match `config.ts` and tests.

## Risks / Pitfalls

- **Do not add `enabled: false` semantics.** D197/R079 require explicit requests to remain available even with automatic mode false.
- **Do not rely on existing `isReviewRequest()` for combined mode.** It will classify `review & format suggestions` as review-only unless a formatter descriptor is built separately.
- **Avoid write-mode false positives.** Formatter-suggestion requests must not go through write PR creation or branch-push flows. Add explicit guard coverage near existing write-intent regression tests.
- **Be careful with local helper scope.** `isReviewRequest()` is currently nested inside `createMentionHandler`; direct parser tests are harder unless this logic is extracted or duplicated. Prefer a new pure intent module for formatter-specific behavior.
- **Queue lane choice affects review coordination.** Combined requests should keep the explicit-review `interactive-review` lane and coordinator claim. Format-only can remain `sync` for S01 unless a future formatter lane is introduced; S04 can rework this when actual subflow execution exists.
- **Config fallback is section-level.** An invalid `review.formatterSuggestions.maxSuggestions` will likely reset all `review` config under the current fallback strategy. If that is unacceptable, planner should allocate a nested fallback task; otherwise document/test the current behavior.

## Skill Discovery

Installed skills relevant to future work:

- `github-bot` exists, but S01 does not need live GitHub API work; S03/S05 may use it for PR review API operations/smoke proof.
- `github-workflows` exists, but not needed for S01.
- `test`/`tdd` skills exist for executor agents implementing tests.

External skill search results (not installed):

- Zod config/schema work: `npx skills add pproenca/dot-skills@zod` (1.9K installs) looked most relevant among Zod results.
- Bun tests: `npx skills add daleseo/bun-skills@bun-test` (130 installs) looked most relevant among Bun test results.
- GitHub API/Octokit: `npx skills add skills.volces.com@github` (219 installs) is more relevant to S03/S05 than S01; existing installed `github-bot` may already cover the practical GitHub API operations.

## Verification Commands

Recommended S01 verification after implementation:

```bash
bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000
```

If the mention suite is too slow for an inner loop, run the new parser/config tests first, then targeted full mention tests. Before marking the slice done, run the full command above.

## Sources / Files Inspected

- `src/execution/config.ts` — Zod config schema, `RepoConfig`, two-pass `loadRepoConfig` fallback.
- `src/execution/config.test.ts` — existing config defaults/parsing/fallback test patterns.
- `src/handlers/mention.ts` — mention normalization, explicit review detection, write-intent guard, executor invocation, queue lane selection.
- `src/handlers/mention.test.ts` — full mention-handler fixture patterns and explicit-review/write-mode regression tests.
- `src/handlers/mention-types.ts` — normalized mention shape and `stripMention()` helper.
- `src/execution/types.ts` — `ExecutionContext` shape for optional descriptor propagation.
- `docs/configuration.md` — current `.kodiai.yml` reference structure.
- `.kodiai.yml` — project-local config example currently has `review.profile`, `review.triggers`, suppressions, path instructions, and write policy; no formatter config exists yet.
- `package.json` — Bun scripts and dependencies; relevant test command uses `bun test`.

## Forward Intelligence

- This slice should produce stable contracts for downstream slices, not implement formatter execution or publication.
- Name the config exactly around capability semantics (`automatic`, not `enabled`) to avoid revisiting S01 in S04.
- Keep the formatter descriptor small and serializable; S02/S04 can add execution-result fields later.
- Tests should prove explicit requests are recognized with `automatic: false`; this is the highest-value acceptance signal for S01.
