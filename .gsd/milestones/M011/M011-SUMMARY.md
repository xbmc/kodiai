---
id: M011
milestone: M011
verification_result: passed
completed_at: migrated
---

# M011: Issue Workflows

**Migrated from v0.11 milestone summary**

## What Happened

## v0.11 Issue Workflows (Shipped: 2026-02-16)

**Scope:** 6 phases (60-65), 15 plans

**Key accomplishments:**
- In-thread issue Q&A now returns concrete answers with code-aware file-path pointers and targeted clarifying questions when context is missing.
- Issue `@kodiai apply:` / `change:` requests can open PRs against the default branch with deterministic write-output identities and branch naming.
- Issue write-mode now enforces idempotent replay behavior, in-flight de-dupe, and rate-limit safety to prevent duplicate PR churn.
- Issue write policy guardrails enforce allow/deny path rules and secret-scan refusals with actionable, non-sensitive remediation guidance.
- Permission and disabled-write failures now return deterministic minimum-scope permission remediation and `.kodiai.yml` enablement guidance with same-command retry.

---
