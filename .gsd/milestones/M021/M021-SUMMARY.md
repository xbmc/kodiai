---
id: M021
milestone: M021
verification_result: passed
completed_at: migrated
---

# M021: Issue Triage Foundation

**Migrated from v0.21 milestone summary**

## What Happened

## v0.21 Issue Triage Foundation (Shipped: 2026-02-27)

**Scope:** 3 phases (103-105), 9 plans
**Timeline:** 2026-02-26
**Source:** [Issue #73](https://github.com/xbmc/kodiai/issues/73)
**Files modified:** 61 (7,828 insertions, 27 deletions)
**Git range:** feat(103-01) → feat(105-03)

**Key accomplishments:**
- Issue corpus with PostgreSQL `issues` and `issue_comments` tables, HNSW vector indexes (cosine, m=16), and weighted tsvector GIN indexes
- IssueStore factory with full CRUD and vector/text search interface matching existing store patterns (15 tests)
- `github_issue_label` MCP tool with label pre-validation, partial application, closed-issue warning, and rate limit retry
- `github_issue_comment` MCP tool with raw markdown and structured input, update-by-ID, and max length enforcement
- Issue template parser that reads `.md` templates from `.github/ISSUE_TEMPLATE/`, extracts YAML frontmatter + section headers, and diffs against issue body
- Triage validation agent with missing-section guidance, `needs-info:{slug}` label recommendations, allowlist gating, and per-issue cooldown wired to `@kodiai` mention path

---
