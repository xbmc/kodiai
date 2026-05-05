# S05: S05

**Goal:** Produce final operational proof that same-PR formatter suggestions work in the deployed GitHub integration, and document how maintainers configure, trigger, verify, and troubleshoot the feature without overstating automatic-mode support.
**Demo:** A deployed run posts at least one committable formatter suggestion on a real/test PR and documents how maintainers enable automatic mode later.

## Must-Haves

- A deployed Kodiai run posts at least one GitHub-accepted formatter suggestion on a real/test PR, the accepted suggestion is verified by a machine-readable smoke verifier, and operator documentation explains explicit requests, future automatic-mode enablement, skipped/capped/failed visibility, and live proof collection.
- Must-haves:
- R085: `bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-key> --delivery-id <delivery-id> --json` proves a real PR review with action `mention-format-suggestions`, review state `COMMENTED`, and at least one associated inline review comment containing a fenced GitHub `suggestion` block.
- R077: The verifier and proof artifact demonstrate same-PR Pull Request Review publication, not a branch push, new PR, standalone bot commit, or issue-comment-only surface.
- R080/R084: Fresh regression commands include the S04 format-only and combined-mode suites so S05 does not rewire or regress combined `review & format suggestions` behavior or independent failure visibility.
- R083: Operator docs and the smoke proof point to formatter subflow fields for `suggestions`, `skipped`, `capped`, `posted`, `publisherSkipped`, and `publisherFailed`.
- Documentation truthfully states that `review.formatterSuggestions.automatic` is parsed/defaulted for later automatic-review inclusion but should not be presented as operational automatic behavior unless a future slice wires and smokes that path.
- Threat surface / Q3:
- Abuse: formatter commands execute in the PR workspace, so docs must direct maintainers to configure deterministic, bounded commands and not user-supplied shell fragments.
- Data exposure: verifier and smoke docs must not print GitHub App private keys/tokens, raw formatter stdout, or unbounded stderr; public proof URLs and bounded status fields are acceptable.
- Input trust: reviewOutputKey, delivery id, repo args, PR review bodies, and review comments are untrusted API/user inputs and must be validated before proof is accepted.
- Requirement impact / Q4:
- Requirements touched: R085 owned, R077/R083 supported, R080/R084 preserved.
- Re-verify: same-PR Pull Request Review suggestion surface, S04 combined-mode independent failure behavior, and operator visibility counts.
- Decisions revisited: D195, D197, D199 are preserved; no new architecture decision is planned unless execution changes automatic-mode semantics or publication shape.
- Memory note: `memory_query` was called for formatter live proof/operator docs context, but the local GSD memory store returned `database disk image is malformed`; executors should rely on these task plans and listed source files.

## Proof Level

- This slice proves: Final-assembly / operational proof. Real runtime required: yes, because R085 requires GitHub to accept at least one Kodiai-generated same-PR committable suggestion on a real/test PR. Human/UAT required: no if API proof links and verifier output are recorded; a screenshot of GitHub's Commit suggestion UI may be added as supporting evidence but is not the primary proof.

## Integration Closure

Upstream consumed: S04 mention orchestration in `src/handlers/mention.ts` and `src/handlers/formatter-suggestion-orchestration.ts`, S03 Pull Request Review publisher in `src/execution/formatter-suggestion-publisher.ts`, S02 formatter diff/commentability mapper in `src/execution/formatter-suggestions.ts`, review-output marker parsing in `src/handlers/review-idempotency.ts`, and live-verifier patterns in `scripts/verify-m049-s02.ts` / `scripts/verify-m065-s02.ts`. New wiring: `verify:m066:s05` in `package.json`, a formatter-specific live proof verifier, operator docs, and a filled smoke proof record. Remaining before milestone usability: nothing after the live verifier passes with a captured `mention-format-suggestions` reviewOutputKey and the smoke artifact records the PR/review/comment evidence.

## Verification

- Slice verification commands:
- `bun test ./scripts/verify-m066-s05.test.ts --timeout 30000`
- `bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-mention-format-suggestions-key> --delivery-id <captured-delivery-id> --json`
- `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000`
- `bunx tsc --noEmit --pretty false`
- `bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts`
- Runtime diagnostics to use when the live smoke fails: S04 logs `Format-only formatter suggestion request completed` and `Combined review-and-format mention request completed`, with formatterStatus, commandStatus, publisherStatus, suggestions, skipped, capped, posted, publisherSkipped, publisherFailed, deliveryId, and reviewOutputKey. Redaction constraints: never expose GitHub App private keys, tokens, raw formatter stdout, or unbounded formatter stderr; proof artifacts may contain public PR/review/comment URLs, delivery id, review id, reviewOutputKey, deployed revision, and bounded status summaries.

## Tasks

- [x] **T01: Added the M066 S05 formatter-suggestion live verifier and test suite.** `est:2h`
  skills_used frontmatter expectation: `github-bot`, `github-workflows`, `gh`, `test-driven-development`, `verify-before-complete`.

Build the machine-readable proof gate for R085. Start test-first in `scripts/verify-m066-s05.test.ts`, then implement `scripts/verify-m066-s05.ts` following the existing verifier style rather than adding a separate framework. The verifier must parse `--repo`, `--review-output-key`, optional `--delivery-id`, `--json`, and `--help`; reject malformed/mismatched args before network access; require `parseReviewOutputKey(key)?.action === "mention-format-suggestions"`; use GitHub App auth from `GITHUB_APP_ID` plus `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64`; list PR reviews and review comments for the PR encoded by the key; find exactly one matching PR review body containing `<!-- kodiai:review-output-key:<key> -->`; require the review source to be a Pull Request Review with `COMMENTED` state; require at least one associated review comment for that review id whose body contains a fenced ```suggestion block; and emit a report with PR URL, review URL/id, first suggestion comment URL/id, artifact counts, status code, preflight access state, and issues. Add `"verify:m066:s05": "bun scripts/verify-m066-s05.ts"` to `package.json`.

Failure Modes (Q5): GitHub App auth missing should return a named missing-access status without printing secret values; GitHub API failures should return a named unavailable status with bounded error text; malformed API data should fail closed with issues explaining which required proof field was absent.

Load Profile (Q6): The verifier performs bounded paginated GitHub reads against one PR (reviews and review comments, 100/page). The 10x breakpoint is GitHub API rate limiting on repeated smoke attempts, so the implementation should avoid repository-wide scans and should stop after enough pages to prove or disprove the specific reviewOutputKey.

Negative Tests (Q7): Cover missing review-output-key, malformed key, wrong action (`mention-review`), delivery-id mismatch, repo mismatch, missing GitHub env, duplicate matching reviews, wrong review state, issue-comment-only/standalone surfaces not satisfying proof, no suggestion-fenced comments, and a happy path with one COMMENTED review plus one suggestion comment.
  - Files: `scripts/verify-m066-s05.ts`, `scripts/verify-m066-s05.test.ts`, `package.json`, `src/handlers/review-idempotency.ts`, `src/review-audit/review-output-artifacts.ts`, `scripts/verify-m049-s02.ts`, `scripts/verify-m065-s02.ts`
  - Verify: bun test ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts

- [x] **T02: Documented explicit formatter-suggestion configuration, operator smoke workflow, and fillable M066 proof record.** `est:1.5h`
  skills_used frontmatter expectation: `write-docs`, `github-workflows`, `azure-container-apps`, `verify-before-complete`.

Add operator-facing documentation for the feature and a fillable smoke proof record. In `docs/configuration.md`, add `review.formatterSuggestions` to the quick-start example and the `review` reference with fields `automatic` (boolean, default false, reserved for later automatic-review inclusion until runtime wiring is added), `command` (optional shell command that must emit a git unified diff to stdout and may use `{baseRef}`, `{headRef}`, `{diffRange}`), and `maxSuggestions` (1..100, default 10). In `docs/runbooks/formatter-suggestions.md`, document setup, safe smoke PR shape, explicit `@kodiai format suggestions`, combined `@kodiai review & format suggestions`, the same-PR Pull Request Review surface, idempotency/retry guidance, skipped/capped/failed counts, log messages/fields, the verifier command, and failure interpretation. Cross-link this runbook from `docs/runbooks/mentions.md`, `docs/README.md`, `docs/INDEX.md`, and a concise feature mention in `README.md`. Create `docs/smoke/m066-formatter-suggestions.md` as the durable proof template with slots for repo, PR URL, trigger comment URL, deliveryId, reviewOutputKey, deployed revision, formatter review URL/id, suggestion comment URL/id, verifier command/output, log query, and any screenshot URL.

Requirement Impact (Q4): This task touches R077, R083, R085, and preserves R080/R084 by documenting existing behavior without changing runtime wiring. It must not claim automatic mode is live for normal automatic PR reviews.
  - Files: `docs/runbooks/formatter-suggestions.md`, `docs/configuration.md`, `docs/runbooks/mentions.md`, `docs/README.md`, `docs/INDEX.md`, `README.md`, `docs/smoke/m066-formatter-suggestions.md`
  - Verify: test -s docs/runbooks/formatter-suggestions.md && test -s docs/smoke/m066-formatter-suggestions.md && rg -n "formatterSuggestions|format suggestions|verify:m066:s05|mention-format-suggestions|skipped|capped|publisherFailed|automatic" README.md docs/configuration.md docs/runbooks/formatter-suggestions.md docs/runbooks/mentions.md docs/README.md docs/INDEX.md docs/smoke/m066-formatter-suggestions.md

- [x] **T03: Recorded a blocked M066 S05 live formatter smoke proof with bounded missing-access diagnostics.** `est:2h`
  skills_used frontmatter expectation: `github-bot`, `github-workflows`, `gh`, `azure-container-apps`, `verify-before-complete`.

Use the implemented docs and verifier to produce the R085 live proof. Prepare or use a controlled test PR in a repo where the Kodiai GitHub App is installed (prefer `xbmc/kodiai` if available). The PR must include a commentable changed line and `.kodiai.yml` formatter config with `automatic: false`, `maxSuggestions: 1`, and a deterministic `bun`/`git diff` command that rewrites that changed line in the PR workspace and emits a unified diff. Trigger `@kodiai format suggestions` first to isolate the formatter path and avoid Claude cost. Capture the GitHub delivery id, reviewOutputKey with action `mention-format-suggestions`, formatter Pull Request Review URL/id, at least one inline suggestion comment URL/id, deployed revision/log correlation fields, and fresh verifier JSON. Update `docs/smoke/m066-formatter-suggestions.md` with the proof bundle. If credentials or deployed access are missing, do not invent proof: leave the proof artifact clearly marked blocked with exact missing key names or access surface and keep the task incomplete.

Failure Modes (Q5): Missing GitHub App env prevents verifier proof; missing app installation or permissions prevents PR review reads/writes; a formatter diff against a non-commentable line maps to no suggestions; duplicate same-delivery/head triggers may idempotency-skip. Each failure should be recorded with deliveryId/reviewOutputKey if available and a retry path.

Load Profile (Q6): One smoke PR, one trigger, one formatter command, one Pull Request Review, and bounded GitHub API reads. The first 10x stress point is GitHub API/rate-limit/idempotency noise from repeated failed retries, so prefer a new trigger comment or new PR head commit per retry rather than hammering the same key.

Negative Tests (Q7): Before accepting proof, confirm T01 tests cover mismatched delivery id, wrong action, wrong surface, duplicates, no suggestion comments, and missing GitHub env; confirm the live command is the positive proof and not merely an issue comment or non-suggestion review body.
  - Files: `docs/smoke/m066-formatter-suggestions.md`, `scripts/verify-m066-s05.ts`, `package.json`, `docs/runbooks/formatter-suggestions.md`, `src/handlers/mention.ts`, `src/handlers/formatter-suggestion-orchestration.ts`, `src/execution/formatter-suggestions.ts`, `src/execution/formatter-suggestion-publisher.ts`
  - Verify: bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-mention-format-suggestions-key> --delivery-id <captured-delivery-id> --json && rg -n "PR URL|reviewOutputKey|formatter review|suggestion comment|verify:m066:s05|m066_s05_ok|mention-format-suggestions" docs/smoke/m066-formatter-suggestions.md

- [x] **T04: Capture live proof inputs and unblock the smoke artifact** `est:1h`
  Convert the blocked smoke record into an executable proof bundle only after real operator/live-smoke inputs are available. If `GITHUB_APP_ID` plus either `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64` are missing, collect them with `secure_env_collect` rather than asking the operator to edit files. Trigger or use a controlled PR with the Kodiai GitHub App installed and a deterministic formatter-suggestion config, then capture the concrete repo slug, delivery id, `mention-format-suggestions` reviewOutputKey, deployed revision/log correlation fields, formatter Pull Request Review URL/id, and suggestion comment URL/id. Export the captured identifiers as `M066_S05_REPO`, `M066_S05_REVIEW_OUTPUT_KEY`, and optional `M066_S05_DELIVERY_ID` for later commands; do not use `<owner/repo>` or other angle-bracket placeholders in any executable command. Update `docs/smoke/m066-formatter-suggestions.md` from blocked to proof-ready only when those fields are real and bounded; otherwise leave it explicitly blocked with missing key names/surfaces and a retry path.
  - Files: `docs/smoke/m066-formatter-suggestions.md`, `docs/runbooks/formatter-suggestions.md`, `scripts/verify-m066-s05.ts`, `package.json`
  - Verify: bash -lc 'test -n "${M066_S05_REPO:-}" && test -n "${M066_S05_REVIEW_OUTPUT_KEY:-}" && case "$M066_S05_REVIEW_OUTPUT_KEY" in *action-mention-format-suggestions*) exit 0 ;; *) echo "M066_S05_REVIEW_OUTPUT_KEY must be a mention-format-suggestions key" >&2; exit 1 ;; esac' && rg -n "PR URL|reviewOutputKey|formatter review|suggestion comment|verify:m066:s05|mention-format-suggestions|deployed revision" docs/smoke/m066-formatter-suggestions.md

- [x] **T05: Run final S05 regression gate with captured live proof** `est:1h`
  Close S05 only after deterministic regression suites pass and the live verifier succeeds against the captured proof variables from T04. Run the S04 preservation suites, S05 verifier tests, typecheck, targeted lint, and then `bun run verify:m066:s05` using quoted environment variables rather than placeholder text. The live verifier must return `m066_s05_ok` for a real same-PR Pull Request Review in `COMMENTED` state with at least one associated inline fenced `suggestion` comment. If live verification reports missing access, unavailable GitHub API, duplicate reviews, wrong action, wrong delivery id, wrong surface, or no suggestion comments, tighten the proof artifact or retry the live smoke with a fresh trigger comment/new PR head commit; do not mark complete with synthetic or blocked proof.
  - Files: `scripts/verify-m066-s05.ts`, `scripts/verify-m066-s05.test.ts`, `package.json`, `docs/runbooks/formatter-suggestions.md`, `docs/smoke/m066-formatter-suggestions.md`, `src/handlers/mention.test.ts`, `src/handlers/formatter-suggestion-orchestration.test.ts`, `src/execution/formatter-suggestions.test.ts`, `src/execution/formatter-suggestion-publisher.test.ts`
  - Verify: bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts && bash -lc 'test -n "${M066_S05_REPO:-}" && test -n "${M066_S05_REVIEW_OUTPUT_KEY:-}" && if test -n "${M066_S05_DELIVERY_ID:-}"; then bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json; else bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --json; fi' && rg -n "m066_s05_ok|PR URL|reviewOutputKey|formatter review|suggestion comment|verify:m066:s05|mention-format-suggestions" docs/smoke/m066-formatter-suggestions.md

## Files Likely Touched

- scripts/verify-m066-s05.ts
- scripts/verify-m066-s05.test.ts
- package.json
- src/handlers/review-idempotency.ts
- src/review-audit/review-output-artifacts.ts
- scripts/verify-m049-s02.ts
- scripts/verify-m065-s02.ts
- docs/runbooks/formatter-suggestions.md
- docs/configuration.md
- docs/runbooks/mentions.md
- docs/README.md
- docs/INDEX.md
- README.md
- docs/smoke/m066-formatter-suggestions.md
- src/handlers/mention.ts
- src/handlers/formatter-suggestion-orchestration.ts
- src/execution/formatter-suggestions.ts
- src/execution/formatter-suggestion-publisher.ts
- src/handlers/mention.test.ts
- src/handlers/formatter-suggestion-orchestration.test.ts
- src/execution/formatter-suggestions.test.ts
- src/execution/formatter-suggestion-publisher.test.ts
