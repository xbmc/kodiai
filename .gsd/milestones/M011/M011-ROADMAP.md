# M011: Issue Workflows

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Issue Q A** `risk:medium` `depends:[]`
  > After this: Define and lock the Issue Q&A response contract in the mention prompt so issue replies are direct, actionable, and path-specific when code evidence is required.
- [x] **S02: Read Only Intent Gating** `risk:medium` `depends:[S01]`
  > After this: Extend the issue mention prompt contract so non-prefixed issue replies are clearly read-only and include explicit apply/change opt-in commands when users ask for implementation.
- [x] **S03: Issue Write Mode Pr Creation** `risk:medium` `depends:[S02]`
  > After this: Enable issue-surface write-mode so explicit `@kodiai apply:` / `@kodiai change:` requests can publish changes and open a PR against the default branch when write-mode is enabled.
- [x] **S04: Intent Gate Idempotency Foundations** `risk:medium` `depends:[S03]`
  > After this: Restore explicit opt-in safety for non-prefixed issue implementation asks.
- [x] **S05: Policy Guardrails Completion** `risk:medium` `depends:[S04]`
  > After this: Add issue-surface-specific regression tests for allowPaths and secretScan refusal paths, completing the trio of policy guardrail tests for issue write-mode.
- [x] **S06: Permission Disabled Ux Completion** `risk:medium` `depends:[S05]`
  > After this: Harden disabled-write UX for issue apply/change requests so users receive deterministic, actionable remediation instead of a generic refusal.
