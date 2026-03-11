# M002: Write Mode

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Mention Ux Parity** `risk:medium` `depends:[]`
  > After this: Enable global @claude alias support for mention triggers, with a per-repo opt-out.
- [x] **S02: Fork Pr Robustness** `risk:medium` `depends:[S01]`
  > After this: Make fork PR reviews robust by cloning the base repo and fetching PR head refs, rather than cloning the fork directly.
- [x] **S03: Xbmc Cutover** `risk:medium` `depends:[S02]`
  > After this: Cut over xbmc/xbmc from @claude GitHub Actions to Kodiai GitHub App with immediate usability: install, webhook wire-up, and smoke tests.
- [x] **S04: Write Mode Foundations** `risk:medium` `depends:[S03]`
  > After this: Lay the foundations for mention-driven code changes by introducing an explicit write-intent path with safe defaults and strong traceability.
- [x] **S05: Write Pipeline** `risk:medium` `depends:[S04]`
  > After this: Enable mention-driven changes end-to-end by letting the model edit files, while keeping branch/commit/push/PR creation in trusted code.
- [x] **S06: Write Guardrails** `risk:medium` `depends:[S05]`
  > After this: Add safety guardrails for mention-driven writes: path policy, secret detection blocks, and basic rate limiting.
- [x] **S07: Write Mode Reliability** `risk:medium` `depends:[S06]`
  > After this: Strengthen write-mode reliability by adding idempotency and lightweight in-process locking so redeliveries and retries do not create duplicate branches/PRs.
- [x] **S08: Observability Verification** `risk:medium` `depends:[S07]`
  > After this: Improve observability and verification UX by standardizing a single evidence bundle log line for each execution and publish.
- [x] **S09: Write Confirmation** `risk:medium` `depends:[S08]`
  > After this: Add an explicit plan-only mention mode so maintainers can ask "what would you change" before triggering write-mode.
- [x] **S10: Next Improvements** `risk:medium` `depends:[S09]`
  > After this: Ship the next set of quality improvements: better write-mode UX (update PR when possible), stronger guardrails, clearer observability, optional delivery metadata, and basic CI.
- [x] **S11: Polish** `risk:medium` `depends:[S10]`
  > After this: Finish remaining polish items: make CI typecheck blocking, tighten guardrails refusal UX, add a non-chatty rereview trigger, and do a smoke test on xbmc repos.
