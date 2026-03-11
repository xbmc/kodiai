# M024: Hallucination Prevention & Fact Verification

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Pr Review Epistemic Guardrails** `risk:medium` `depends:[]`
  > After this: Add epistemic boundary rules to the PR review prompt so the LLM distinguishes diff-visible facts from external knowledge claims.
- [x] **S02: Cross Surface Epistemic Guardrails** `risk:medium` `depends:[S01]`
  > After this: unit tests prove cross-surface-epistemic-guardrails works
- [x] **S03: Claim Classification** `risk:medium` `depends:[S02]`
  > After this: unit tests prove claim-classification works
- [x] **S04: Severity Demotion** `risk:medium` `depends:[S03]`
  > After this: Implement severity demotion for findings whose core claims depend on unverified external knowledge.
- [x] **S05: Output Filtering** `risk:medium` `depends:[S04]`
  > After this: Implement output filtering for findings with external knowledge claims before publishing.
