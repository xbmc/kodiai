# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R001 — Addon repo detection
- Class: core-capability
- Status: active
- Description: PRs to configured addon repos (`xbmc/repo-plugins`, `xbmc/repo-scripts`, `xbmc/repo-scrapers`, extensible) must trigger the addon-check handler
- Why it matters: enforcement only fires where it's needed; non-addon repos are unaffected
- Source: user
- Primary owning slice: M030/S01
- Supporting slices: none
- Validation: unmapped
- Notes: repo list must be configurable via env var or AppConfig, not hardcoded

### R002 — kodi-addon-checker subprocess execution
- Class: core-capability
- Status: active
- Description: The official `kodi-addon-checker` tool (pip package `kodi-addon-checker`) must run as a subprocess against the cloned addon directory within the existing workspace
- Why it matters: re-implementing the rule logic in TypeScript would drift from the authoritative checker; running the real tool guarantees parity with what CI enforces
- Source: user
- Primary owning slice: M030/S02
- Supporting slices: none
- Validation: unmapped
- Notes: requires Python 3 + pip in Dockerfile (base image is Debian); checker installed at image build time

### R003 — Branch → Kodi version mapping
- Class: core-capability
- Status: active
- Description: The `--branch` argument to `kodi-addon-checker` must be derived from the PR's base branch name (e.g. `nexus`, `matrix`, `leia`)
- Why it matters: checker validates version-specific rules; wrong branch gives wrong results
- Source: inferred
- Primary owning slice: M030/S02
- Supporting slices: none
- Validation: unmapped
- Notes: PR base branch in addon repos is the Kodi version name; `ValidKodiVersions` in the checker tool defines the valid set

### R004 — Output parsing (ERROR/WARN/INFO)
- Class: core-capability
- Status: active
- Description: stdout lines from `kodi-addon-checker` in `LEVEL: message` format must be parsed into structured findings with severity mapped to Kodiai's severity tiers
- Why it matters: raw tool output can't be posted directly; needs structure for filtering, dedup, and rendering
- Source: inferred
- Primary owning slice: M030/S02
- Supporting slices: M030/S03
- Validation: unmapped
- Notes: tool exits 1 on errors, 0 on warnings-only or clean; both cases need output captured

### R005 — PR comment posting in Kodiai style
- Class: primary-user-loop
- Status: active
- Description: Violations must be posted as a PR comment matching Kodiai's existing comment formatting style, including severity indicators
- Why it matters: maintainers see a consistent interface regardless of whether a finding came from code review or addon rule enforcement
- Source: user
- Primary owning slice: M030/S03
- Supporting slices: none
- Validation: unmapped
- Notes: user confirmed "following these rules" — use existing comment format conventions

### R006 — Configurable addon repo list
- Class: operability
- Status: active
- Description: The list of repos that trigger addon enforcement must be configurable (env var or AppConfig entry), not hardcoded
- Why it matters: more repos may be added later without a code change
- Source: user
- Primary owning slice: M030/S01
- Supporting slices: none
- Validation: unmapped
- Notes: default to `xbmc/repo-plugins,xbmc/repo-scripts,xbmc/repo-scrapers`

### R007 — Python + tool installed in Dockerfile
- Class: constraint
- Status: active
- Description: Python 3 and `kodi-addon-checker` must be installed in the production Dockerfile
- Why it matters: subprocess execution fails silently or crashes if tool not present at runtime
- Source: inferred
- Primary owning slice: M030/S02
- Supporting slices: none
- Validation: unmapped
- Notes: base image is `oven/bun:1-debian`; Python 3 + pip available via apt; install at image build time

### R008 — Multi-addon support per PR
- Class: core-capability
- Status: active
- Description: A single PR may touch multiple addons (each in its own subdirectory); all affected addons must be checked
- Why it matters: repo-plugins contains hundreds of addons; a PR touching two addons should produce findings for both
- Source: inferred
- Primary owning slice: M030/S02
- Supporting slices: none
- Validation: unmapped
- Notes: detect affected addons by finding top-level subdirs in the changed file list that contain `addon.xml`

### R009 — Idempotent re-run on synchronize
- Class: continuity
- Status: active
- Description: Each push to a PR must re-run the check; the previous comment must be updated or replaced, not appended
- Why it matters: stale findings from a prior commit create noise and false signals
- Source: inferred
- Primary owning slice: M030/S03
- Supporting slices: none
- Validation: unmapped
- Notes: use a comment marker (same pattern as existing handlers) to find and update the previous comment

### R010 — Non-addon repos unaffected
- Class: constraint
- Status: active
- Description: Handler must be a no-op for repos not in the addon repo list; existing review pipeline must be unaffected
- Why it matters: regression risk — the existing review flow must not change
- Source: inferred
- Primary owning slice: M030/S01
- Supporting slices: none
- Validation: unmapped
- Notes: enforce via early return on repo check before any workspace or subprocess work

## Validated

(none yet — M030 not started)

## Deferred

(none)

## Out of Scope

### R020 — Inline annotations per finding
- Class: anti-feature
- Status: out-of-scope
- Description: Posting `kodi-addon-checker` findings as inline PR review annotations (line-level comments)
- Why it matters: prevents scope creep; checker output is file-level or addon-level, not always line-mapped
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: user confirmed PR comment (not PR review with inline annotations)

### R021 — Status check / CI gate
- Class: anti-feature
- Status: out-of-scope
- Description: Setting a GitHub commit status or check run to block merging
- Why it matters: distinguishes informational enforcement (comment) from blocking gate
- Source: user
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: user chose PR comment only

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | core-capability | active | M030/S01 | none | unmapped |
| R002 | core-capability | active | M030/S02 | none | unmapped |
| R003 | core-capability | active | M030/S02 | none | unmapped |
| R004 | core-capability | active | M030/S02 | M030/S03 | unmapped |
| R005 | primary-user-loop | active | M030/S03 | none | unmapped |
| R006 | operability | active | M030/S01 | none | unmapped |
| R007 | constraint | active | M030/S02 | none | unmapped |
| R008 | core-capability | active | M030/S02 | none | unmapped |
| R009 | continuity | active | M030/S03 | none | unmapped |
| R010 | constraint | active | M030/S01 | none | unmapped |
| R020 | anti-feature | out-of-scope | none | none | n/a |
| R021 | anti-feature | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 10
- Mapped to slices: 10
- Validated: 0
- Unmapped active requirements: 0
