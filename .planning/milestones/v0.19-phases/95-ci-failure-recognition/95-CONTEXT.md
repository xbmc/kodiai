# Phase 95: CI Failure Recognition - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Kodiai annotates CI failures that appear unrelated to the PR, giving maintainers confidence to merge without investigating pre-existing breakage. Uses the Checks API (not Actions API) so external CI systems like Jenkins are included. Does not post when all checks pass. Does not block approval or lower merge confidence based on unrelated failures.

</domain>

<decisions>
## Implementation Decisions

### Annotation comment design
- Summary line + expandable details per check (e.g., "3 of 5 failures appear unrelated to this PR" with collapsible per-check reasoning)
- Presented as a section within the existing Kodiai review comment, not a standalone comment
- Each check shows base-branch evidence ("Also fails on main@abc123") plus flakiness stats ("Failed 8 of last 20 runs")
- Each verdict carries a confidence indicator: High (exact base-branch match), Medium (flaky override pattern), Low (weaker signal)

### Unrelatedness classification
- Exact check name match: if the same check name fails on the PR head and on the base branch, it's classified as unrelated
- Compare against the last N (3-5) commits on the base branch, not just the merge-base SHA — catches intermittent failures
- If no base-branch check results exist to compare against, skip the CI annotation section entirely (no guessing)
- PR-only failures (pass on base, fail on PR) are classified as "possibly PR-related" by default
- Flaky override: if a PR-only failure has >30% failure rate in its flakiness history, it can be classified as unrelated with medium confidence

### Flakiness tracking
- Dedicated database table tracking check name, pass/fail per run, rolling window stats
- Rolling window of last 20 runs per check for flakiness calculation
- 30% failure rate threshold (6 of 20 runs) marks a check as "flaky"
- Build up data organically as Kodiai processes PRs — no historical backfill on first run
- Cold start accepted: no flakiness signal for first few weeks until data accumulates

### Trigger timing & edge cases
- Triggered on `check_suite` completed webhook event (may fire multiple times per PR if multiple CI systems)
- Update/append the CI section as results arrive from different check suites
- When a re-run passes, update the CI section to remove the resolved failure — keep the section accurate with current state
- No CI section when all checks pass (no noise on clean PRs)
- On new push to PR (new SHA), clear previous CI analysis and re-analyze when new checks complete
- Does not lower merge confidence or block approval based on failures classified as unrelated

### Claude's Discretion
- Exact number of base-branch commits to check (3-5 range)
- Expandable details formatting (HTML details/summary vs other approach)
- How to handle check suites that are still pending when analysis runs
- Rate limiting / debouncing of multiple check_suite events

</decisions>

<specifics>
## Specific Ideas

- The summary line should give an at-a-glance verdict: "3 of 5 failures appear unrelated to this PR"
- Confidence levels map to classification signals: High = base-branch match, Medium = flaky override, Low = weaker signal
- The section should disappear cleanly when all failures resolve on re-run

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 95-ci-failure-recognition*
*Context gathered: 2026-02-25*
