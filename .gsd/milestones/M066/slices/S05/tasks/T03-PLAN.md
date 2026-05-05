---
estimated_steps: 5
estimated_files: 8
skills_used: []
---

# T03: Recorded a blocked M066 S05 live formatter smoke proof with bounded missing-access diagnostics.

skills_used frontmatter expectation: `github-bot`, `github-workflows`, `gh`, `azure-container-apps`, `verify-before-complete`.

Use the implemented docs and verifier to produce the R085 live proof. Prepare or use a controlled test PR in a repo where the Kodiai GitHub App is installed (prefer `xbmc/kodiai` if available). The PR must include a commentable changed line and `.kodiai.yml` formatter config with `automatic: false`, `maxSuggestions: 1`, and a deterministic `bun`/`git diff` command that rewrites that changed line in the PR workspace and emits a unified diff. Trigger `@kodiai format suggestions` first to isolate the formatter path and avoid Claude cost. Capture the GitHub delivery id, reviewOutputKey with action `mention-format-suggestions`, formatter Pull Request Review URL/id, at least one inline suggestion comment URL/id, deployed revision/log correlation fields, and fresh verifier JSON. Update `docs/smoke/m066-formatter-suggestions.md` with the proof bundle. If credentials or deployed access are missing, do not invent proof: leave the proof artifact clearly marked blocked with exact missing key names or access surface and keep the task incomplete.

Failure Modes (Q5): Missing GitHub App env prevents verifier proof; missing app installation or permissions prevents PR review reads/writes; a formatter diff against a non-commentable line maps to no suggestions; duplicate same-delivery/head triggers may idempotency-skip. Each failure should be recorded with deliveryId/reviewOutputKey if available and a retry path.

Load Profile (Q6): One smoke PR, one trigger, one formatter command, one Pull Request Review, and bounded GitHub API reads. The first 10x stress point is GitHub API/rate-limit/idempotency noise from repeated failed retries, so prefer a new trigger comment or new PR head commit per retry rather than hammering the same key.

Negative Tests (Q7): Before accepting proof, confirm T01 tests cover mismatched delivery id, wrong action, wrong surface, duplicates, no suggestion comments, and missing GitHub env; confirm the live command is the positive proof and not merely an issue comment or non-suggestion review body.

## Inputs

- `docs/smoke/m066-formatter-suggestions.md`
- `scripts/verify-m066-s05.ts`
- `package.json`
- `docs/runbooks/formatter-suggestions.md`
- `src/handlers/mention.ts`
- `src/handlers/formatter-suggestion-orchestration.ts`
- `src/execution/formatter-suggestions.ts`
- `src/execution/formatter-suggestion-publisher.ts`

## Expected Output

- `docs/smoke/m066-formatter-suggestions.md`

## Verification

bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-mention-format-suggestions-key> --delivery-id <captured-delivery-id> --json && rg -n "PR URL|reviewOutputKey|formatter review|suggestion comment|verify:m066:s05|m066_s05_ok|mention-format-suggestions" docs/smoke/m066-formatter-suggestions.md

## Observability Impact

Records the live correlation bundle tying GitHub delivery id, formatter reviewOutputKey, deployed revision, formatter subflow logs, same-PR review URL, and suggestion comment URL to the verifier result.
