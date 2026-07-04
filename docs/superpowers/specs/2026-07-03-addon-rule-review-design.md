# Addon Rule Review Design

Date: 2026-07-03
Issue: https://github.com/xbmc/kodiai/issues/194

## Goal

Python addon pull requests in `xbmc/repo-plugins`, `xbmc/repo-scrapers`, and `xbmc/repo-scripts` should receive a Kodi addon submission-rule review instead of a generic Python code review. The review should help human reviewers catch obvious rule violations while leaving final judgment to them.

The existing `kodi-addon-checker` integration remains in place. The new addon-rule review is merged into the same idempotent addon-check PR comment so addon submissions have one canonical Kodiai addon review surface.

## Trigger Behavior

Automatic behavior:

- Run addon-rule review automatically on `pull_request.opened` for configured addon repositories.
- Do not rerun addon-rule review automatically on `pull_request.synchronize`.
- Existing checker behavior may continue on synchronize, but the new LLM rule-review portion must not rerun unless explicitly requested.

Manual behavior:

- In configured addon repositories, `@kodiai review` routes to the specialized addon-rule review instead of the generic review prompt.
- The manual trigger updates the same addon-check comment rather than creating a separate generic review comment.

Repository scope:

- `xbmc/repo-plugins`
- `xbmc/repo-scrapers`
- `xbmc/repo-scripts`

## Review Scope

The addon-rule review may inspect full changed files, not only diff hunks. It should still focus on files relevant to addon submission review:

- `addon.xml`
- Python files
- JavaScript files for addons that provide a web interface
- Repository file lists for forbidden development artifacts, binary extensions, license files, and translation path rules

General code review drift is acceptable when it supports addon submission-rule review. The review should not be constrained to style-only or correctness-only generic Python review.

## Rule Source

Primary source:

- Fetch current Kodi Add-on rules from https://kodi.wiki/view/Add-on_rules.

Fallback source:

- Use embedded prompt rules derived from issue #194 and Roman's attached `review-kodi-addon.md` command if the wiki fetch fails, times out, or returns unusable content.

The published comment should cite the Kodi Add-on rules URL in the addon-rule review section. It should not expose raw fetched wiki HTML or unbounded rule text.

## Review Components

### Existing Checker

Keep `kodi-addon-checker` execution and bounded classification:

- Run per changed addon directory.
- Preserve timeout and tool-unavailable classification.
- Keep existing redaction behavior for raw checker output, workspace paths, GitHub payloads, and skipped addon identifiers.

### Deterministic Checks

Add deterministic addon-rule checks for high-confidence file and manifest rules. Initial deterministic checks should include:

- Development-only artifacts in addon directories, such as CI configs, linter configs, test runner config, unit tests, and integration tests.
- Forbidden binary extensions except allowed image and font extensions.
- Missing license file in each changed addon directory.
- `resources/language` translation directories that do not match `resource.language.<lc_cc>` with lowercase language/region.
- `addon.xml` language attribute values for `summary`, `description`, and `disclaimer` that do not use `lc_CC`.
- Missing English `summary` or `description` in `addon.xml`.
- Non-SPDX-looking `license` values in `addon.xml`, with conservative matching to avoid false certainty.

Deterministic findings should use `ERROR` for clear rule violations and `WARN` for cases that need human confirmation.

### LLM Rule Review

Add an LLM review pass for addon-rule checks that are difficult to identify reliably with simple static rules. It should inspect bounded content from full changed files and changed file lists. It should look for:

- Direct reads/writes outside addon profile, addon path, or Kodi temp rules.
- Writes to addon install paths or other addon directories.
- Downloads that occur without user consent.
- Running executable files.
- Installing or modifying other addons, including `UpdateLocalAddons`.
- Direct Kodi database access instead of JSON-RPC.
- `Container.SetViewMode(id)` or `Container.SetSortMethod(id)`.
- Usage analytics such as Google Analytics.
- Obfuscated scripts, with minified JS allowed only for web-interface addons and still scanned for common security problems.

The prompt should explicitly state:

- Prefer addon submission-rule findings over generic Python style/correctness feedback.
- Use `ERROR` and `WARN`, no merge verdict.
- Findings must be grounded in changed addon files or the changed file list.
- If evidence is uncertain, emit a `WARN` or omit the finding.
- Do not mention reviewer names, prior PR backlinks, raw prompts, or hidden system context.

The LLM output should be parsed into structured findings. Malformed or unsafe output should fail closed for the LLM section while still publishing checker and deterministic results.

## Comment Format

Keep a single idempotent PR comment using the existing addon-check marker.

Recommended structure:

```markdown
<!-- kodiai:addon-check:owner/repo:123 -->
## Kodiai Addon Check

<existing incomplete diagnostic if any>
<existing kodi-addon-checker table or clean message>

## Kodi Add-on Rule Review

Rules source: <https://kodi.wiki/view/Add-on_rules>

| Addon | Level | Source | Message |
|-------|-------|--------|---------|
| plugin.video.example | ERROR | deterministic | Missing English description in addon.xml. |
| plugin.video.example | WARN | llm | File download appears to happen without a user confirmation prompt. |

_N error(s), M warning(s) found by addon-rule review._
```

If no addon-rule findings are found:

```markdown
✅ No addon-rule issues found by Kodiai's addon-rule review.
```

If wiki rules could not be loaded:

```markdown
Rules source: embedded fallback based on <https://kodi.wiki/view/Add-on_rules>
```

If `kodi-addon-checker` is unavailable or times out, still post or update the combined comment with the bounded checker diagnostic and addon-rule review results.

## Data Flow

1. Webhook or mention trigger enters addon review path for configured addon repos.
2. Fetch PR file list.
3. Determine changed addon directories.
4. Checkout PR workspace.
5. Run existing `kodi-addon-checker` flow and classification.
6. Load addon rules from Kodi wiki with timeout and embedded fallback.
7. Collect bounded full changed-file content for addon-rule review.
8. Run deterministic checks.
9. Run LLM rule review when there are scoped files to review.
10. Merge checker findings, deterministic findings, LLM findings, and incomplete diagnostics.
11. Upsert the existing addon-check comment.

## Error Handling

- Wiki fetch failure: use embedded fallback and note fallback source in comment.
- LLM timeout or malformed output: omit LLM findings, include a bounded warning that addon-rule LLM review was incomplete, and still publish deterministic/checker results.
- `kodi-addon-checker` unavailable or timed out: keep current bounded diagnostic and still publish addon-rule review results.
- Checkout failure or GitHub API failure: log as non-fatal handler failure, matching current addon-check behavior.
- Oversized file content: truncate or omit with a bounded note; do not pass unbounded files to the model.

## Testing

Unit tests:

- Deterministic checker flags forbidden dev artifacts, invalid translation paths, missing license, missing English manifest text, invalid language codes, and obvious forbidden binaries.
- Deterministic checker ignores allowed image/font binaries and unrelated out-of-scope files.
- Rule source loader uses wiki content when available and embedded fallback on fetch failure.
- LLM prompt builder includes addon rules, full changed-file context, scope constraints, and `ERROR`/`WARN` output contract.
- LLM parser accepts valid structured findings and rejects malformed/unsafe output.
- Formatter renders combined checker and addon-rule sections in one idempotent comment.

Handler tests:

- `pull_request.opened` in addon repos runs checker plus addon-rule review.
- `pull_request.synchronize` does not run the addon-rule LLM review automatically.
- `@kodiai review` in addon repos routes to addon-rule review instead of generic review.
- Combined comment is posted even when `kodi-addon-checker` is unavailable or timed out.

Verification:

- Run targeted addon-check, mention routing, formatter, and prompt tests.
- Run TypeScript typecheck.
- Run lint on touched files.

## Open Decisions

No unresolved product decisions remain from the design discussion. Implementation should keep behavior conservative where exact rule interpretation is ambiguous: emit `WARN` for human review or omit the finding.
