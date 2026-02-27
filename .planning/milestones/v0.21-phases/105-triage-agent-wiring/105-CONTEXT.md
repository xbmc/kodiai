# Phase 105: Triage Agent Wiring - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

When a maintainer mentions `@kodiai` on an issue, the bot validates the issue body against the repo's template, comments with specific missing-field guidance, and applies a label. This phase wires the template parser, triage agent, and mention handler together.

</domain>

<decisions>
## Implementation Decisions

### Validation behavior
- Template matching: best-effort — try GitHub frontmatter metadata first, fall back to header matching if metadata isn't present
- All template sections are required by default unless explicitly marked optional (e.g., `<!-- optional -->` comment in template)
- Flag both absent headings AND headings with empty/placeholder content; distinguish them in the comment
- If issue doesn't match any template in `.github/ISSUE_TEMPLATE/`: post a generic nudge suggesting the user pick a template (no field-level validation)

### Comment style
- Friendly helper tone: warm and encouraging ("Thanks for filing! A few details would help us help you faster...")
- Bulleted list of missing sections, each with section name + one-line hint on what's expected
- Only show what's missing — no collapsible pass/fail breakdown
- Keep comments short and actionable

### Label strategy
- Convention-based labels: `needs-info:{template_name}` auto-derived from the template filename
- Label allowlist in `.kodiai.yml` permits/denies labels (no manual template-to-label mapping needed)
- If the derived label doesn't exist on the repo: skip labeling and mention it in the comment so the maintainer can create it
- No label on passing issues — validation != triage (team defines "triaged" as "reproduced by a team member")

### Mention behavior & cooldown
- Always respond when `@kodiai` is mentioned on an issue
- Primary: answer whatever question was asked (most important)
- Secondary: if template fields are missing, append a brief one-sentence triage nudge alongside the response
- Cooldown is per-issue, resets when the issue body is edited
- On re-triage after edit: post a new comment (not update the existing one)
- No config toggle for mention-based triage — it's always available when kodiai is installed
- Full auto-triage on `issues.opened` is a separate future feature (IINT-01), not this phase

### Claude's Discretion
- Template parser implementation details (regex vs AST for markdown parsing)
- How to detect placeholder text vs real content
- Exact comment formatting and markdown structure
- Cooldown storage mechanism

</decisions>

<specifics>
## Specific Ideas

- "Triaged" means "reproduced by a team member" in this project — the bot doing validation is not triage, it's template compliance checking
- The triage nudge when fields are missing should be a single sentence appended to whatever the bot's primary response is, not a separate verbose comment
- Template validation is secondary to answering the user's question — if someone asks `@kodiai` a question, the answer comes first

</specifics>

<deferred>
## Deferred Ideas

- Auto-triage on `issues.opened` event — IINT-01 (v0.22)
- Semantic duplicate detection using issue vector corpus — IINT-02 (v0.22)

</deferred>

---

*Phase: 105-triage-agent-wiring*
*Context gathered: 2026-02-26*
