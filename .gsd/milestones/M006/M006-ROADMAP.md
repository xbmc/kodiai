# M006: Review Output Formatting & UX

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: State Memory And Isolation Foundation** `risk:medium` `depends:[]`
  > After this: Add durable SHA-keyed run state to the knowledge store and integrate it into the review handler for idempotent webhook processing.
- [x] **S02: Incremental Re Review With Retrieval Context** `risk:medium` `depends:[S01]`
  > After this: Add config schema extensions and KnowledgeStore query methods for incremental re-review.
- [x] **S03: Multi Language Context And Localized Output** `risk:medium` `depends:[S02]`
  > After this: Add programming language classification to diff analysis and outputLanguage to the config schema.
- [x] **S04: Explainable Learning And Delta Reporting** `risk:medium` `depends:[S03]`
  > After this: Create a delta classification module that compares current review findings against prior review findings using filePath:titleFingerprint composite keys to label each finding as `new`, `still-open`, or `resolved`.
- [x] **S05: Structured Review Template** `risk:medium` `depends:[S04]`
  > After this: Rewrite the standard-mode summary comment prompt and add a reviewed-categories helper

Purpose: Instruct Claude to produce the five-section structured template (What Changed, Strengths, Observations, Suggestions, Verdict) instead of the current issues-only format, and dynamically generate the FORMAT-02 "Reviewed: .
- [x] **S06: Findings Organization And Tone** `risk:medium` `depends:[S05]`
  > After this: Rewrite the standard-mode Observations section prompt from severity-only grouping to Impact/Preference subsections with inline severity tags.
- [x] **S07: Verdict And Merge Confidence** `risk:medium` `depends:[S06]`
  > After this: Rewrite the Verdict section template, add a Verdict Logic prompt section, update the Suggestions section template, and update hard requirements in `buildReviewPrompt()` to deliver explicit merge recommendations driven by blocker counts.
- [x] **S08: Review Details Embedding** `risk:medium` `depends:[S07]`
  > After this: Rewrite formatReviewDetailsSummary() to produce the minimal FORMAT-13 output (4 factual lines), remove buildMetricsInstructions() from the prompt, and modify the handler flow to embed Review Details into the summary comment when one exists.
- [x] **S09: Delta Re Review Formatting** `risk:medium` `depends:[S08]`
  > After this: Add a delta-focused re-review template to the prompt builder that replaces the standard five-section template when incremental re-review data is available, and thread the delta context from review.
