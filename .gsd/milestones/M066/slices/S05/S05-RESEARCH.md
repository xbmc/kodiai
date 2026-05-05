# S05 Research: Live smoke proof and operator docs

## Summary

S05 is an operational/integration slice, not a new formatter architecture slice. S01-S04 already provide the explicit PR mention entrypoints, deterministic formatter-command/diff mapper, batched Pull Request Review publisher, formatter-specific idempotency key, and structured logs. S05 should focus on two deliverables:

1. **Live proof** that a deployed Kodiai run posted at least one GitHub-accepted formatter suggestion on a real/test PR.
2. **Operator docs/runbook** that accurately explain explicit requests, setup, log correlation, failure modes, and the current/future automatic-mode contract.

The main surprise: `review.formatterSuggestions.automatic` is parsed and defaulted, but I found no runtime consumer in the automatic PR review path. The only current formatter subflow invocation is mention-driven (`@kodiai format suggestions` and `@kodiai review & format suggestions`) in `src/handlers/mention.ts`. S05 docs must not claim that `automatic: true` currently runs formatter suggestions on normal reviews unless a task explicitly wires that behavior into the review path.

Memory lookup for prior architecture notes failed with `database disk image is malformed`; rely on the preloaded S04 summary and code evidence below.

## Requirements Targeting

- **Owns R085** — live GitHub smoke proof that at least one Kodiai-generated suggestion is accepted as a committable same-PR suggestion.
- **Supports R077** — same-PR GitHub committable suggestions, not branch pushes/new PRs/bot commits.
- **Preserves R080/R084** — combined `review & format suggestions` and independent failure visibility were already validated in S04; S05 should verify and document, not rewire unnecessarily.
- **Carries R083 operator visibility** — skipped/capped/failed counts are already present in subflow results/logs; docs and smoke proof should show where to find them.

## Skill Discovery

Relevant installed skills from the system prompt:

- `github-bot` — directly relevant if an executor chooses to use GitHub API actions to create/comment on the live smoke PR. Use programmatic access rather than manual GitHub work when available.
- `github-workflows` / `gh` — useful if the live proof uses `gh api` or checks GitHub-side PR/review state.
- `azure-container-apps` — relevant to deploy/Log Analytics evidence because production runs on Azure Container Apps.
- `write-docs` — relevant for operator-facing runbooks and configuration docs.
- `verify-before-complete` / `verification-before-completion` — relevant before claiming S05 or M066 complete; fresh proof is required.

External skill search performed for Bun/TypeScript CLI verification scripts:

- `dmythro/agent-skills@bun-cli` — 22 installs, relevant if the team wants a Bun-specific CLI skill. Install command: `npx skills add dmythro/agent-skills@bun-cli`.
- `dralgorhythm/claude-agentic-framework@typescript` — 34 installs, generic TypeScript support; less specifically useful here than local verifier patterns.
- `knoopx/pi@typescript` — 32 installs, generic TypeScript; not essential for this slice.

No install is necessary to plan S05; the repo already has strong verifier patterns.

## Implementation Landscape

### Existing formatter runtime path

`src/handlers/mention.ts`

- Detects formatter requests after mention stripping via `detectFormatterSuggestionRequest()`.
- Format-only requests (`@kodiai format suggestions`) short-circuit before Claude execution and call `runFormatterSuggestionForMention("format-only")`.
- Combined requests (`@kodiai review & format suggestions`) are treated as explicit review requests, run Claude review first, and then run formatter suggestions.
- Queue lanes:
  - format-only is **not** an explicit review request, so it queues on `lane: "sync"`.
  - combined review+format queues on `lane: "interactive-review"`.
- Important log messages/fields for S05:
  - `Format-only formatter suggestion request completed`
    - fields: `formatterStatus`, `commandStatus`, `publisherStatus`, `suggestions`, `skipped`, `capped`, `posted`, `publisherSkipped`, `publisherFailed`, `visibleReplyPosted`, `visibleReplyFailed`.
  - `Combined review-and-format mention request completed`
    - adds `reviewConclusion`, `publishResolution`, `formatterPartialFailure`, `combinedPartialFailure`.
  - `Combined review-and-format formatter subflow completed after review executor threw` for executor-throw partial failure proof.

`src/handlers/formatter-suggestion-orchestration.ts`

- Central helper that composes S02/S03:
  - `runFormatterCommand()`
  - `collectDiffContext()`
  - `buildPrDiffCommentabilityIndex()`
  - `mapFormatterDiffToSuggestions()`
  - `publishFormatterSuggestionReview()`
- Defaults:
  - review output action: `mention-format-suggestions`
  - formatter timeout: `120_000ms`
  - diff range: `origin/{baseRef}...HEAD`
- Returns structured statuses: `setup-needed`, `no-op`, `pr-diff-unavailable`, `mapped-no-suggestions`, `posted`, `duplicate`, `blocked`, `failed`.
- Builds formatter review output keys with action `mention-format-suggestions`; this is the strongest correlation key for live proof.

`src/execution/formatter-suggestions.ts`

- Runs configured command using `Bun.spawn(["bash", "-lc", command])` in the PR workspace.
- Formatter command must exit `0` and write a git unified diff to stdout.
- Placeholders supported: `{baseRef}`, `{headRef}`, `{diffRange}`.
- Mapper only emits suggestions when the formatter replacement range maps to commentable RIGHT-side PR diff lines.
- Skips pure insertion, pure deletion, unsupported files, malformed diffs, non-commentable target ranges, and cap overflow.

`src/execution/formatter-suggestion-publisher.ts`

- Publishes one `pulls.createReview` request with `event: "COMMENT"`, a review body headed `Kodiai formatter suggestions`, and batched inline comments.
- Each comment body is the GitHub suggestion fence generated by the mapper:
  - ````markdown
    ```suggestion
    replacement text
    ```
    ````
- Review body includes `<!-- kodiai:review-output-key:<key> -->` when the subflow provides a key.
- Uses the same idempotency scan/gate pattern as review output; duplicate live runs with the same delivery/head key will skip.
- Secret scanning and mention sanitization apply before publication.

`src/execution/config.ts`

- Config fields already exist:
  - `review.formatterSuggestions.automatic` default `false`
  - `review.formatterSuggestions.command` optional non-empty string
  - `review.formatterSuggestions.maxSuggestions` default `10`, range `1..100`
- **Constraint:** `automatic` currently has no runtime consumer outside parsing/tests. It is not wired into automatic review handling.

### Existing docs and gaps

`docs/configuration.md`

- Complete `.kodiai.yml` reference exists, but it does **not** document `review.formatterSuggestions` yet.
- Add a dedicated section under `review`, ideally near `review.maxComments` / review output controls.
- Quick Start example should include a commented formatter suggestions block or a concise example.

`README.md`

- Code Review feature line mentions inline suggestions and explicit reviews, but not formatter suggestions.
- Add a small mention that explicit `@kodiai format suggestions` can publish same-PR formatter suggestions when configured.

`docs/runbooks/mentions.md`

- This is the natural operator troubleshooting home for mention routing and queue evidence.
- Add formatter-specific expected behavior/log messages, including sync lane for format-only and interactive-review lane for combined mode.

`docs/runbooks/review-requested-debug.md`

- Mostly about explicit `@kodiai review`; only needs a short cross-reference for combined `@kodiai review & format suggestions` if the planner adds a formatter runbook.

`docs/runbooks/formatter-suggestions.md` (recommended new file)

- New focused runbook should cover setup, triggering, live smoke, log correlation, and failure interpretation.
- Add links from `docs/README.md` and `docs/INDEX.md`.

`docs/smoke/m066-formatter-suggestions.md` (recommended new file)

- Durable live proof artifact/template. Once the executor runs the smoke, fill in PR URL, trigger comment URL, deliveryId, formatter review URL/id, inline suggestion comment URL, reviewOutputKey, deployed revision, and verification command output.

### Existing verifier patterns to copy

`package.json`

- Existing milestone verifiers are exposed as `verify:mNNN` / `verify:mNNN:sXX` package scripts.
- No `verify:m066:*` scripts currently exist.

`scripts/verify-m049-s02.ts`

- Best live GitHub + Azure verifier pattern for S05.
- It already demonstrates:
  - GitHub App env preflight: `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`.
  - loading private key from PEM, path, or base64.
  - creating a GitHub App installation Octokit via `createGitHubApp()`.
  - optional Azure Log Analytics discovery/query fields.
  - JSON and human-readable reports.

`src/review-audit/review-output-artifacts.ts`

- Existing artifact collector can find review output markers in review comments, issue comments, and reviews.
- It is geared toward clean review body validation, but parts can be reused for formatter proof:
  - `parseReviewOutputKey()` from `src/handlers/review-idempotency.ts`
  - `collectReviewOutputArtifacts()` can prove the marker is on a PR review body.
- For formatter-specific proof, a new helper should additionally inspect review comments associated with the posted review and check for suggestion fences.

`docs/runbooks/m065-rollout-proof.md`

- Good runbook pattern for machine-checkable live-proof commands and failure interpretation.

## Recommended Build Plan / Natural Seams

### 1. Add a formatter-specific live verifier

Create `scripts/verify-m066-s05.ts` and `scripts/verify-m066-s05.test.ts`, then add `"verify:m066:s05": "bun scripts/verify-m066-s05.ts"` to `package.json`.

Recommended CLI:

```sh
bun run verify:m066:s05 -- \
  --repo <owner/repo> \
  --review-output-key <kodiai-review-output:...action-mention-format-suggestions...> \
  [--delivery-id <github-delivery-id>] \
  [--json]
```

Verifier checks should be machine-readable and conservative:

- Parse and normalize the review output key.
- Require `action === "mention-format-suggestions"`.
- Require optional `--delivery-id` to match the key’s effective delivery id when provided.
- Use GitHub App auth to access the PR.
- Find exactly one matching PR **review** artifact containing the marker. A formatter suggestion review should not be an issue comment or standalone review-comment-only artifact.
- Require the review state to be compatible with a comment review (likely `COMMENTED`; tolerate GitHub API variations only with explicit detail).
- List PR review comments and find at least one comment for that review id whose body contains a fenced `suggestion` block.
- Return the review URL/id and at least one inline suggestion comment URL as proof artifacts.
- Optionally query Azure logs for the same `reviewOutputKey` / `deliveryId` and require or warn on fields: `formatterStatus=posted`, `publisherStatus=posted`, `posted>=1`, `suggestions>=1`, `capped`/`skipped` present.

GitHub API note from current docs: `Create a review for a pull request` supports `event: COMMENT`, `commit_id`, `body`, and `comments[]` with `path`, `body`, `line`, `side`, `start_line`, and `start_side`. It requires Pull requests write permission and returns `422` for validation/spam rejection. That matches the current publisher shape.

If the planner wants a top-level M066 verifier too, add `scripts/verify-m066.ts` after S05 with nested proof + deterministic regression suites. That is optional for the slice but useful for milestone closure.

### 2. Add operator docs

Suggested files:

- `docs/runbooks/formatter-suggestions.md` — main runbook.
- `docs/configuration.md` — configuration reference section.
- `docs/runbooks/mentions.md` — formatter mention triage excerpt/cross-link.
- `docs/README.md` and `docs/INDEX.md` — link the new runbook/smoke doc.
- `README.md` — short feature mention.
- `docs/smoke/m066-formatter-suggestions.md` — live proof record/template, later filled with actual proof.

Docs must be truthful about automatic mode. Given current code, either:

- document `automatic` as a parsed/defaulted field reserved for future automatic-review inclusion, while explicit requests work now; or
- add runtime wiring for automatic mode in a separate implementation task before documenting `automatic: true` as operational.

The roadmap wording says S05 documents how maintainers enable automatic mode **later**. The safer doc wording is: explicit requests are available now; `automatic` defaults false and should not be enabled operationally until the automatic review path is wired and smoke-tested.

### 3. Run live smoke and fill proof artifact

Recommended controlled smoke target: `xbmc/kodiai` test PR, because existing docs identify it as the safest/fastest smoke repo with known GitHub App permissions.

Smoke PR setup idea:

- Create a small branch/PR containing:
  - a harmless file with one intentionally misformatted line that is part of the PR diff, e.g. `docs/smoke/m066-formatter-target.md` with `formatter   smoke`.
  - `.kodiai.yml` change adding a formatter command for the smoke.
- Use a command that mutates the checked-out PR workspace and emits `git diff` to stdout. Because the runtime has Bun, a one-line Bun command is safer than assuming Python:

```yaml
review:
  formatterSuggestions:
    automatic: false
    maxSuggestions: 1
    command: >-
      bun -e "const fs=require('fs'); const p='docs/smoke/m066-formatter-target.md'; fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace('formatter   smoke','formatter smoke'));" && git diff -- docs/smoke/m066-formatter-target.md
```

Operational details:

- The formatter command runs in the PR workspace after checkout.
- Mapper requires the replacement range to be commentable on the PR RIGHT side, so the line changed by the formatter must already be in the PR diff.
- Trigger with `@kodiai format suggestions` first. This avoids Claude cost and isolates the formatter subflow.
- Optional second smoke: `@kodiai review & format suggestions` to prove combined mode still behaves live, but R085 only requires at least one accepted formatter suggestion.
- Capture the GitHub delivery id from the GitHub App deliveries UI, then correlate logs by `deliveryId` and/or `reviewOutputKey`.
- Use the new verifier against the captured `reviewOutputKey`.

### 4. Fresh deterministic regression

Before closing S05, rerun the S04 regression suites plus the new docs/verifier tests:

```sh
bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts --timeout 30000
bun test ./scripts/verify-m066-s05.test.ts --timeout 30000
bunx tsc --noEmit --pretty false
bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts
bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-key> --delivery-id <delivery-id> --json
```

Use `verify-before-complete`: do not claim S05 is complete until the live verifier passes or the proof artifact explicitly records a blocker requiring human decision.

## Risks / Constraints

- **Automatic-mode truthfulness:** `automatic` is parsed but not wired into automatic reviews. This is the highest docs risk.
- **Live proof cannot be fully simulated:** fixture tests already cover payload shape; R085 requires GitHub accepting/rendering a real suggestion.
- **Commentability coupling:** formatter-changed lines must overlap PR RIGHT-side diff lines. A formatter diff against an unchanged line will map to `target-range-not-in-pr-diff` and produce no suggestions.
- **Idempotency:** repeated triggers with the same delivery/head key skip duplicates. For repeated smoke attempts, post a new trigger comment or push a new PR head commit.
- **Runtime command availability:** use `bun` and `git`, which are already core runtime assumptions, instead of repo-specific formatter binaries for the smoke.
- **Secrets:** verifier/live smoke may require GitHub App env vars. If missing during execution, use `secure_env_collect`; do not ask the user to paste secrets.
- **GitHub UI proof:** API checks can prove review/comment/suggestion-block existence and GitHub acceptance. If the acceptance criterion is interpreted as visual “Commit suggestion” rendering, capture a screenshot/link in `docs/smoke/m066-formatter-suggestions.md` as supporting evidence.

## Sources

- Code: `src/handlers/mention.ts`
- Code: `src/handlers/formatter-suggestion-orchestration.ts`
- Code: `src/execution/formatter-suggestions.ts`
- Code: `src/execution/formatter-suggestion-publisher.ts`
- Code: `src/execution/config.ts`
- Code: `src/review-audit/review-output-artifacts.ts`
- Code: `scripts/verify-m049-s02.ts`
- Docs: `docs/configuration.md`, `docs/runbooks/mentions.md`, `docs/runbooks/review-requested-debug.md`, `docs/runbooks/m065-rollout-proof.md`, `docs/deployment.md`
- GitHub docs search query used: `GitHub REST API pulls create review comments suggested changes suggestion block committable suggested change`
- GitHub docs: `https://docs.github.com/en/rest/pulls/reviews?apiVersion=2026-03-10` — `Create a review for a pull request` parameters and status codes.
