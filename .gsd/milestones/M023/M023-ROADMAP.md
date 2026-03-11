# M023: Interactive Troubleshooting

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Troubleshooting Retrieval Foundation** `risk:medium` `depends:[]`
  > After this: Extend IssueStore with state-filtered search, build a resolution-focused thread assembler, and create the troubleshooting retrieval orchestrator with wiki fallback and silent no-match.
- [x] **S02: Troubleshooting Agent** `risk:medium` `depends:[S01]`
  > After this: Create the troubleshooting intent classifier (keyword heuristics), comment-scoped marker dedup functions, and register the troubleshooting.
- [x] **S03: Outcome Capture** `risk:medium` `depends:[S02]`
  > After this: Create the database migration for outcome capture, implement the issue-closed webhook handler with outcome classification and triage linkage, and wire it into the application.
- [x] **S04: Threshold Learning** `risk:medium` `depends:[S03]`
  > After this: Create the database migration for per-repo Bayesian threshold state and implement the pure threshold-learner module with Beta-Binomial updating, sample gate, and clamping.
- [x] **S05: Reaction Tracking** `risk:medium` `depends:[S04]`
  > After this: Create the reaction tracking infrastructure: a PostgreSQL table for reaction snapshots, a standalone sync script that polls GitHub reactions on triage comments and feeds them into the Bayesian threshold learner, and a GitHub Actions nightly cron workflow.
