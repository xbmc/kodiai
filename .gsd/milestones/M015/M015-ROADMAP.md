# M015: Slack Write Workflows

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Slack Write Mode Enablement** `risk:medium` `depends:[]`
  > After this: Define and wire Slack write-intent routing so explicit prefixes and medium-confidence conversational asks can enter write mode safely, while ambiguous asks stay read-only with a deterministic retry affordance.
