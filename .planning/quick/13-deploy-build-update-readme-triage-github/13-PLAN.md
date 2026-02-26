---
phase: 13-deploy-build-update-readme-triage-github
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - README.md
autonomous: false
requirements: []

must_haves:
  truths:
    - "Latest v0.20 code is running in Azure production and health check passes"
    - "README accurately describes all v0.1-v0.20 capabilities"
    - "GitHub release v0.20 exists with comprehensive release notes"
    - "Issue #66 is closed as completed"
    - "Issues #73, #74, #75 have triage comments acknowledging their milestone status"
  artifacts:
    - path: "README.md"
      provides: "Up-to-date project documentation reflecting v0.20 capabilities"
      min_lines: 150
  key_links:
    - from: "deploy.sh"
      to: "Azure Container Apps"
      via: "ACR remote build + containerapp update"
      pattern: "Health check passed"
    - from: "README.md"
      to: "MILESTONES.md"
      via: "Milestones section reference"
      pattern: "MILESTONES.md"
---

<objective>
Deploy v0.20 to Azure production, update README to reflect 19 milestones of capability growth, create a GitHub release, and triage the 4 open issues.

Purpose: Ship v0.20 to production, make the project discoverable with accurate docs, and clean up issue tracker.
Output: Running production deployment, updated README.md, GitHub v0.20 release, triaged issues.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/MILESTONES.md
@README.md
@deploy.sh
</context>

<tasks>

<task type="auto">
  <name>Task 1: Deploy v0.20 to Azure</name>
  <files>deploy.sh</files>
  <action>
Run the existing deploy script to push the latest v0.20 code to Azure Container Apps:

```bash
bash deploy.sh
```

The script is idempotent -- it sources `.env`, builds the image via ACR remote build, updates the container app with a new revision, and runs a post-deploy health check.

After deploy completes, verify the health endpoint manually:
```bash
FQDN=$(az containerapp show --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn --output tsv)
curl -s "https://${FQDN}/healthz"
curl -s "https://${FQDN}/readiness"
```

Both should return HTTP 200.
  </action>
  <verify>
Health check passes: `curl -s -o /dev/null -w "%{http_code}" "https://$(az containerapp show --name ca-kodiai --resource-group rg-kodiai --query properties.configuration.ingress.fqdn --output tsv)/healthz"` returns 200
  </verify>
  <done>v0.20 code deployed to Azure Container Apps, health and readiness endpoints return 200</done>
</task>

<task type="auto">
  <name>Task 2: Rewrite README and create GitHub release v0.20</name>
  <files>README.md</files>
  <action>
**Part A: Rewrite README.md** to reflect all capabilities through v0.20. Keep the existing structure but expand sections:

1. **Opening paragraph** -- Update to describe Kodiai as a mature GitHub App with PR review, @kodiai mentions, issue workflows, Slack integration, knowledge-backed retrieval, multi-LLM routing, and contributor intelligence. Not just a "PR auto-review + mentions" app.

2. **What It Does** -- Expand to cover all major feature areas:
   - PR Auto-Review (existing, but add: draft PR review, incremental re-review, dependency bump deep-review, CI failure recognition, risk-weighted file prioritization, pattern clustering footnotes)
   - @kodiai Mentions (existing, but add: conversational follow-ups, cross-surface support)
   - Issue Workflows (NEW: in-thread Q&A, `apply:`/`change:` PR creation, write-mode guardrails, permission remediation)
   - Slack Integration (NEW: `#kodiai` channel, thread sessions, read/write modes, confirmation gating)
   - Knowledge System (NEW: 4-corpus hybrid retrieval -- code, review comments, wiki, code snippets; BM25+vector with RRF; cross-corpus citations)
   - Multi-LLM Routing (NEW: task-type model selection, per-repo overrides, provider fallback)
   - Contributor Profiles (NEW: identity linking, expertise scoring, 4-tier adaptive review)
   - Wiki Staleness Detection (NEW: two-tier evaluation, scheduled Slack reports)
   - Review Pattern Clustering (NEW: HDBSCAN+UMAP, theme labels, footnote injection)
   - Cost Tracking (NEW: per-invocation model/token/cost logging)

3. **Architecture** -- Update to reflect current stack:
   - Bun + Hono server
   - PostgreSQL + pgvector (not SQLite)
   - VoyageAI embeddings (voyage-code-3, 1024 dims)
   - Multi-LLM via Vercel AI SDK + Agent SDK
   - Azure Container Apps deployment

4. **Configuration** -- Add brief section noting `.kodiai.yml` per-repo config support.

5. Keep existing sections: Local Development, Tests, PR Creation helper, Deployment, Milestones reference.

Use `.planning/MILESTONES.md` as the source of truth for what capabilities exist.

**Part B: Create GitHub release v0.20** using `gh release create`:

Create the release with tag `v0.20`, title "v0.20 Multi-Model & Active Intelligence", targeting the current main branch HEAD.

The release body should be a curated summary (NOT a copy-paste of MILESTONES.md). Structure:

```
## What's New in v0.20

Brief 2-3 sentence overview of the journey from v0.1 to v0.20.

### Highlights Since v0.1

Group by theme (not by version number):
- **Knowledge-Backed Reviews** -- 4-corpus hybrid retrieval, cross-corpus citations
- **Issue Workflows** -- in-thread Q&A, PR creation from issues
- **Slack Integration** -- thread sessions, read/write modes
- **Multi-LLM Routing** -- task-based model selection, cost tracking
- **Contributor Intelligence** -- profiles, expertise scoring, adaptive review depth
- **Review Quality** -- pattern clustering, draft PR review, dependency deep-review, CI failure recognition
- **Infrastructure** -- PostgreSQL+pgvector, graceful shutdown, zero-downtime deploys

### Version History

Link to MILESTONES.md for per-version details.

### Full Changelog

Auto-generated link from v0.1 to v0.20.
```

Use `gh release create v0.20 --target main --title "v0.20 Multi-Model & Active Intelligence" --notes "..."` with the body via heredoc or temp file.
  </action>
  <verify>
`gh release view v0.20 --json tagName,name -q '.tagName + " " + .name'` returns "v0.20 v0.20 Multi-Model & Active Intelligence" AND `head -5 README.md` shows updated content
  </verify>
  <done>README.md reflects all v0.1-v0.20 capabilities. GitHub release v0.20 exists with themed release notes covering 19 milestones of development.</done>
</task>

<task type="auto">
  <name>Task 3: Triage open GitHub issues</name>
  <files></files>
  <action>
Triage the 4 open GitHub issues:

**Issue #66 (v0.20 Multi-Model & Active Intelligence)** -- CLOSE as completed.
- Add comment: "v0.20 shipped on 2026-02-26. All 20 requirements satisfied, 6 phases (97-102) and 17 plans complete. Closing as completed. See release: https://github.com/xbmc/kodiai/releases/tag/v0.20"
- Close with `gh issue close 66 --reason completed --comment "..."`

**Issue #73 (v0.21 Issue Triage Foundation)** -- Keep open, add triage comment.
- Add comment acknowledging this is the next planned milestone. Note that v0.20 shipped and this is queued for v0.21.
- `gh issue comment 73 --body "..."`

**Issue #74 (v0.22 Issue Intelligence)** -- Keep open, add triage comment.
- Add comment noting this depends on #73 shipping first. Queued for v0.22.
- `gh issue comment 74 --body "..."`

**Issue #75 (v0.23 Interactive Troubleshooting)** -- Keep open, add triage comment.
- Add comment noting this depends on #73 and #74. Queued for v0.23.
- `gh issue comment 75 --body "..."`

Keep triage comments brief and factual (2-3 sentences each). Do NOT add roadmap speculation or timelines.
  </action>
  <verify>
`gh issue view 66 --json state -q '.state'` returns "CLOSED" AND `gh issue view 73 --json comments -q '.comments | length'` shows at least 1 comment
  </verify>
  <done>Issue #66 closed as completed with release link. Issues #73, #74, #75 have triage comments acknowledging their milestone queue position.</done>
</task>

</tasks>

<verification>
- Production health check returns 200
- README.md has sections for all major v0.20 features (knowledge, Slack, multi-LLM, contributor profiles)
- `gh release view v0.20` shows the release
- `gh issue view 66 --json state` shows CLOSED
- Issues #73, #74, #75 remain open with triage comments
</verification>

<success_criteria>
1. Azure deployment healthy at production FQDN
2. README reflects complete v0.1-v0.20 capability set
3. GitHub release v0.20 published with themed release notes
4. Issue #66 closed, issues #73-#75 triaged with comments
</success_criteria>

<output>
After completion, create `.planning/quick/13-deploy-build-update-readme-triage-github/13-SUMMARY.md`
</output>
