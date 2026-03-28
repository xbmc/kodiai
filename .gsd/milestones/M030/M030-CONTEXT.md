# M030: Addon Rule Enforcement

**Gathered:** 2026-03-28
**Status:** Ready for planning

## Project Description

Kodiai is a GitHub App providing automated code review, issue intelligence, and Slack integration for Kodi repositories. M030 extends it to enforce the official Kodi addon rules on PRs submitted to the addon repos (`xbmc/repo-plugins`, `xbmc/repo-scripts`, `xbmc/repo-scrapers`).

## Why This Milestone

Addon repo maintainers manually review PRs for rule compliance (binary files, missing artwork, invalid addon.xml, Python 2 usage, etc.) before merging. The official `kodi-addon-checker` tool already encodes all these rules but currently runs only in per-addon CI, not on the repo-side PR submissions. Kodiai can run it automatically and post structured feedback to contributors, reducing maintainer burden on high-volume queues.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Open a PR against `xbmc/repo-plugins` (or `repo-scripts`, `repo-scrapers`) and receive a structured comment from Kodiai listing any addon rule violations found by `kodi-addon-checker`
- See violations formatted consistently with Kodiai's existing review style (severity, message, addon ID)
- Push a fix to the PR and see the previous comment updated (not duplicated) with the new check results

### Entry point / environment

- Entry point: GitHub webhook `pull_request.opened` / `pull_request.synchronize` on configured addon repos
- Environment: production webhook handler + cloned workspace (same as existing review flow)
- Live dependencies involved: GitHub API (PR files, comment posting), `kodi-addon-checker` subprocess, existing workspace manager

## Completion Class

- Contract complete means: unit tests cover repo detection, output parsing, comment formatting, idempotent update
- Integration complete means: full webhook → subprocess → comment flow exercised end-to-end in a real environment
- Operational complete means: Dockerfile updated with Python + checker; deployed instance handles live PR

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A PR to `xbmc/repo-plugins` (or equivalent test fixture) triggers the handler and produces a correctly formatted comment
- A second push to the same PR updates the existing comment rather than posting a new one
- Non-addon repos receive no comment and no workspace is cloned for them

## Risks and Unknowns

- `kodi-addon-checker` output format stability — tool is actively maintained; output is `LEVEL: message` per line; stable enough to parse with a simple regex
- Branch name → `ValidKodiVersions` mapping — checker rejects unknown branch names; need fallback if PR targets a branch not in the valid set (e.g. a maintenance branch or draft)
- Python install size in Dockerfile — adds ~50-100MB to image; acceptable, but worth noting

## Existing Codebase / Prior Art

- `src/handlers/review.ts` — primary model for new handler structure; enqueues jobs, clones workspace, posts comment
- `src/handlers/issue-opened.ts` — simpler handler example; good reference for handler scaffold without LLM
- `src/jobs/workspace.ts` — workspace manager used to clone repos; already handles the addon repos
- `src/webhook/router.ts` — handler registration via `register("pull_request.opened", handler)`
- `src/config.ts` — AppConfig Zod schema; addon repo list goes here
- `src/handlers/review-idempotency.ts` — marker-based comment dedup pattern; reuse for idempotent updates

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R001 — Addon repo detection
- R002 — kodi-addon-checker subprocess execution
- R003 — Branch → Kodi version mapping
- R004 — Output parsing
- R005 — PR comment posting in Kodiai style
- R006 — Configurable addon repo list
- R007 — Python + tool in Dockerfile
- R008 — Multi-addon support per PR
- R009 — Idempotent re-run on synchronize
- R010 — Non-addon repos unaffected

## Scope

### In Scope

- New `addon-check.ts` handler registered on `pull_request.opened` and `pull_request.synchronize`
- Repo list check (early return for non-addon repos)
- Workspace clone + `kodi-addon-checker` subprocess per affected addon dir
- Output parser: `ERROR`/`WARN`/`INFO` → structured findings
- PR comment formatter using Kodiai comment style
- Idempotent comment update via marker
- Dockerfile: Python 3 + `kodi-addon-checker` installed
- AppConfig entry + env var for configurable addon repo list
- Unit tests for detection, parsing, formatting

### Out of Scope / Non-Goals

- Inline PR review annotations (line-level comments)
- GitHub status checks / CI blocking
- LLM-based semantic analysis (the checker handles all rule logic)
- Running the checker on non-PR events (push to branch, etc.)

## Technical Constraints

- `kodi-addon-checker` requires `--branch <kodi-version>` with a value from `ValidKodiVersions`; unknown branch names must fall back gracefully (skip or warn, not crash)
- Workspace clones already handle the addon repos; no new clone infrastructure needed
- Subprocess must time out (same timeout approach as existing LLM calls)
- Comment marker must be unique to the addon-check handler to avoid collision with review comments

## Integration Points

- `src/jobs/workspace.ts` — clone the PR head for the addon repo
- `src/webhook/router.ts` — register handler on pull_request events
- `src/config.ts` — add `addonRepos` to AppConfig
- GitHub API — list PR files, post/update PR comment
- `kodi-addon-checker` CLI — subprocess, parse stdout

## Open Questions

- Should warnings produce a comment, or only errors? — default: post both, clearly distinguished; INFO can be omitted
- What if the checker isn't installed (e.g. during local dev)? — fail-open with a logged warning, no comment posted
