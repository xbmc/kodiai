# Concise Kodi Add-on Review Design

Date: 2026-07-19  
Issue: https://github.com/xbmc/kodiai/issues/194

## Reader and outcome

This design is for the engineer implementing and reviewing Kodiai's add-on submission flow. After reading it, they should be able to replace generic Python review on configured Kodi add-on repositories with one concise, evidence-backed add-on compliance comment.

This design supersedes the earlier add-on-rule review design where the two conflict, especially on full-file review, generic-review routing, and the public comment format.

## Problem

Kodi add-on submissions are reviewed for repository submission rules, not general Python correctness, style, architecture, or code quality. Kodiai currently exposes two problems:

- The generic review pipeline can still run automatically on an add-on pull request and publish an unrelated code-quality decision.
- The specialized add-on flow returns only violations. A clean review therefore says little more than "no issues found" and cannot explain what changed or what evidence was reviewed.

The attached review command in issue 194 was not translated faithfully. It requires diff-only inspection, a narrow file and rule scope, and no Python quality review. Kodiai currently supplies full changed-file content and describes add-on-rule review as a preference rather than an exclusive scope.

## Goals

- Publish one canonical Kodiai add-on review comment per pull request.
- Give human reviewers a brief factual summary, concrete findings when present, and an advisory verdict.
- Apply the scope and rules from issue 194 explicitly.
- Review changed evidence only.
- Keep `kodi-addon-checker` as supporting evidence without allowing timeout diagnostics to dominate the comment.
- Leave final approval to a human reviewer.

## Non-goals

- Assessing Python or JavaScript correctness, syntax, logic, maintainability, architecture, formatting, or style.
- Approving, rejecting, or merging a pull request.
- Reviewing unchanged files merely because they are present in the checked-out add-on.
- Reimplementing every Kodi rule as a deterministic TypeScript check.
- Publishing raw model output, raw checker output, workspace paths, prompts, or hidden diagnostics.

## Chosen approach

Use a specialized structured add-on review flow for configured add-on repositories. It combines deterministic checks, a narrowly prompted model pass, and a deterministic formatter.

The model produces a bounded factual summary and candidate rule findings. Kodiai validates those fields, combines them with deterministic findings, and derives the verdict from validated findings and completeness state. The model never decides approval.

This approach is preferred over a prompt-only change because routing and evidence scope are part of the defect. It is preferred over a fully deterministic implementation because consent, filesystem behavior, downloads, and similar rules often require contextual interpretation.

## Routing

Configured add-on repositories are the single source of truth for specialized routing. Matching is case-insensitive and uses the existing configured repository list.

- On pull request open, the specialized add-on flow runs and the generic review pipeline skips the event before workspace or model work.
- On pull request synchronize, the checker may rerun according to existing behavior. The model-backed rule review does not rerun automatically unless explicitly requested.
- An explicit `@kodiai review` request routes to the specialized flow and updates the same canonical comment.
- Non-add-on repositories retain the existing generic review behavior.

This prevents the generic `Decision: APPROVED` or `Decision: NOT APPROVED` surface from appearing alongside an add-on review.

## Evidence and review scope

### Allowed evidence

The review may use:

- Repository identity and pull request number.
- Pull request target branch.
- Changed file paths, statuses, and bounded patches supplied by GitHub.
- Add-on identity and version changes that can be established from an `addon.xml` patch.
- `kodi-addon-checker` structured findings that can be tied to a changed path or changed manifest evidence, plus its bounded completion classification.
- The current Kodi add-on rules, with the issue-194 policy as a bounded fallback and scope constraint.

The model must not receive full modified files. If GitHub omits a patch or a patch is truncated, that file is marked unassessed rather than replaced with full head content.

### Files and checks in scope

Content review is limited to:

- `addon.xml` patches.
- Python patches.
- JavaScript patches for add-ons providing a web interface.

Changed paths may also be inspected for development-tool artifacts, disallowed binary extensions, license-file changes, and translation-directory naming.

The policy covers:

- Valid target branches using Kodi symbolic version names from `matrix` onward; `master` is invalid.
- Development-only files, tests, CI configuration, and tool configuration.
- Obfuscated scripts, with the documented minified web-interface JavaScript exception.
- Disallowed binary types.
- License requirements when the license is introduced or changed. An unchanged license is reported as not assessed, not inferred as passing.
- Translation directory naming.
- Relevant `addon.xml` structure, localized metadata, language codes, and SPDX license identifiers when those lines are present in the diff.
- Filesystem access boundaries and user consent.
- Downloads, executable execution, add-on installation or modification, and `UpdateLocalAddons`.
- Direct Kodi database access.
- Skin view and sort mode switching.
- Usage analytics.

The prompt states these as exclusive review criteria. It must say "do not review" Python and JavaScript quality, correctness, syntax, logic, style, or architecture; wording such as "prefer add-on rules" is too weak.

## Structured result

The model result has two validated fields:

- `summary`: one to three concise factual sentences and no more than 600 characters. It identifies the add-on, version change when evidenced, target branch, and the nature of the changed code without judging code quality.
- `findings`: no more than 20 candidate `ERROR` or `WARN` findings. Each contains the add-on ID, changed path when available, violated rule, and a concrete explanation of no more than 400 characters grounded in a patch.

Kodiai rejects malformed, ungrounded, unsafe, or overlong fields. Deterministic and model findings are deduplicated. A missing or rejected summary falls back to a deterministic summary using repository, add-on IDs, target branch, changed-path counts, and known checker state.

The advisory verdict is computed in code:

- Complete review with no findings: `No addon-rule violations found.`
- Findings present: `Needs human review: N errors and M warnings found.`
- Any material evidence source incomplete: append a short statement that the review is incomplete and name the bounded reason.

Every verdict ends with `Final approval remains with a human reviewer.` It never uses `Approved`, `Not Approved`, `merge`, or equivalent decision language.

## Public comment

The existing idempotent marker remains the canonical update key. The normal clean result is:

```markdown
<!-- kodiai:addon-check:xbmc/repo-scripts:2862 -->
## Kodiai Add-on Review

### Summary

`script.audiooffsetmanager` updates from 1.5.0 to 2.1.0 on the valid `nexus`
target branch. The diff is a substantial internal Python package rewrite and
removes the bundled test video.

### Findings

No addon-rule violations were found in the reviewed diff.

### Verdict

No addon-rule violations found. Final approval remains with a human reviewer.
```

When findings exist, the Findings section uses concise bullets rather than a source-oriented table:

```markdown
### Findings

- **ERROR** `plugin.video.example/default.py`: Runs a downloaded executable;
  Kodi add-ons may not run executable files.
- **WARN** `plugin.video.example/resources/lib/client.py`: The changed download
  path has no visible user-consent prompt; confirm consent is obtained before download.
```

Finding provenance remains available in structured logs but is not useful in the contributor-facing comment.

If `kodi-addon-checker` times out, the comment adds one short caveat after the summary. Internal modes, reason-code lists, millisecond budgets, redaction prose, and omitted identifiers stay out of the main comment.

## Data flow

1. Route the event based on the configured add-on repository list.
2. Fetch all changed-file metadata and patches.
3. Resolve and deterministically validate the target branch.
4. Group changed evidence by add-on ID.
5. Run `kodi-addon-checker` within its existing bounds and retain contributor-facing findings only when they can be tied to changed evidence.
6. Load the live Kodi rules or the bounded fallback policy.
7. Run deterministic checks over changed paths and patch evidence.
8. Run the model review only when scoped patch content exists.
9. Validate, bound, and deduplicate the structured result.
10. Derive completeness and the advisory verdict.
11. Format and upsert the canonical add-on review comment.

## Failure behavior

- Live rule source unavailable: use the embedded issue-194 policy and mention the fallback in one short caveat.
- Model timeout or malformed output: retain deterministic and checker findings, use a deterministic summary, and mark the review incomplete.
- Checker timeout or unavailable: retain rule-review findings and mark checker coverage incomplete without exposing internal diagnostics.
- Patch unavailable or truncated: do not read the full file; identify the affected evidence as unassessed and mark the review incomplete when material.
- Comment publication failure: preserve existing non-fatal logging and retry behavior.
- Unknown or invalid target branch: publish a concrete rule finding rather than silently skipping the entire review.

## Testing

Tests are written before production changes and cover:

- Generic auto-review skips configured add-on repositories before expensive work.
- Add-on repositories still enter the specialized flow on open and explicit review requests.
- Non-add-on review behavior is unchanged.
- Prompt wording makes rule scope exclusive and forbids code-quality review.
- Context contains bounded patches, not full modified-file content.
- Version and change summaries are grounded in patch evidence.
- Clean, finding, invalid-branch, missing-patch, checker-timeout, model-timeout, and fallback-rule cases render concise comments.
- Verdict text is derived from findings and completeness and never expresses approval.
- Unsafe, malformed, ungrounded, and overlong model fields are rejected.
- The canonical marker continues to update one comment.

Verification includes targeted unit and handler tests, TypeScript type checking, scoped linting, and a formatter snapshot or exact-output test for the public comment.

## Rollout and acceptance

The change is accepted when a representative add-on pull request produces one concise add-on review comment, no generic review decision, and a summary and verdict traceable to changed evidence. A clean review must remain explicitly advisory. A timeout must remain useful to a human reviewer without exposing internal operational detail.

Release notes should call out the contributor-facing comment change and the suppression of generic code-quality review for configured add-on repositories.
