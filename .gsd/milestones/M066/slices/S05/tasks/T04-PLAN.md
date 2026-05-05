---
estimated_steps: 1
estimated_files: 4
skills_used: []
---

# T04: Capture live proof inputs and unblock the smoke artifact

Convert the blocked smoke record into an executable proof bundle only after real operator/live-smoke inputs are available. If `GITHUB_APP_ID` plus either `GITHUB_PRIVATE_KEY` or `GITHUB_PRIVATE_KEY_BASE64` are missing, collect them with `secure_env_collect` rather than asking the operator to edit files. Trigger or use a controlled PR with the Kodiai GitHub App installed and a deterministic formatter-suggestion config, then capture the concrete repo slug, delivery id, `mention-format-suggestions` reviewOutputKey, deployed revision/log correlation fields, formatter Pull Request Review URL/id, and suggestion comment URL/id. Export the captured identifiers as `M066_S05_REPO`, `M066_S05_REVIEW_OUTPUT_KEY`, and optional `M066_S05_DELIVERY_ID` for later commands; do not use `<owner/repo>` or other angle-bracket placeholders in any executable command. Update `docs/smoke/m066-formatter-suggestions.md` from blocked to proof-ready only when those fields are real and bounded; otherwise leave it explicitly blocked with missing key names/surfaces and a retry path.

## Inputs

- `Completed T03 blocked proof artifact`
- `Controlled GitHub PR with Kodiai App installation`
- `GitHub App verifier credentials`
- `S04 formatter suggestion orchestration outputs/log fields`

## Expected Output

- `docs/smoke/m066-formatter-suggestions.md updated with concrete repo/reviewOutputKey/review/comment/deployment fields or kept blocked with exact missing access surface`
- `Shell environment contains M066_S05_REPO and M066_S05_REVIEW_OUTPUT_KEY for T05 without angle-bracket placeholders`

## Verification

bash -lc 'test -n "${M066_S05_REPO:-}" && test -n "${M066_S05_REVIEW_OUTPUT_KEY:-}" && case "$M066_S05_REVIEW_OUTPUT_KEY" in *action-mention-format-suggestions*) exit 0 ;; *) echo "M066_S05_REVIEW_OUTPUT_KEY must be a mention-format-suggestions key" >&2; exit 1 ;; esac' && rg -n "PR URL|reviewOutputKey|formatter review|suggestion comment|verify:m066:s05|mention-format-suggestions|deployed revision" docs/smoke/m066-formatter-suggestions.md

## Observability Impact

Confirms the final operator-visible signals and proof commands are fresh before closure; no new runtime observability should be added here unless verification exposes a gap.
