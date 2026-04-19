---
id: T02
parent: S01
milestone: M051
key_files:
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Support `@kodiai review` as the only operator-supported manual rereview trigger until fresh human-generated proof exists for the `ai-review` / `aireview` UI path.
  - When the `github-bot` skill token helper is unavailable in this environment, use authenticated `gh` CLI commands as the GitHub write fallback.
duration: 
verification_result: passed
completed_at: 2026-04-18T23:29:01.982Z
blocker_discovered: false
---

# T02: Recorded decision D124 to keep `@kodiai review` as the supported manual rereview trigger and updated issue #84 with the same evidence-backed guidance.

**Recorded decision D124 to keep `@kodiai review` as the supported manual rereview trigger and updated issue #84 with the same evidence-backed guidance.**

## What Happened

I used T01’s audit as the evidence boundary rather than reopening the topology investigation. First I reviewed the existing decision register and the live issue #84 thread, then recorded decision D124: `@kodiai review` remains the only supported manual rereview trigger until a fresh human-generated `pull_request.review_requested` delivery proves the `ai-review` / `aireview` UI team path end-to-end. The decision captures the narrower reality T01 established: the old “Kodiai is not on the team” premise is no longer true because `aireview` exists on `xbmc/kodiai` and currently includes `kodiai`, and the repo-side config/handler contract still accepts `ai-review` / `aireview`; the missing piece is operator-path proof, not team topology. I then mirrored that exact contract into issue #84 so the operator-facing guidance now matches the decision register and explicitly classifies the UI team rereview path as wired but unproven instead of supported. During the issue update I also found an environment-specific gotcha: the `github-bot` skill’s token helper exits 127 here because it hardcodes `/Users/joel/.local/bin/secrets`. I documented that fallback rule in `.gsd/KNOWLEDGE.md` and used the already-authenticated `gh api` path to publish the authoritative issue comment without changing the contract itself.

## Verification

Verification was state-based because this task’s outputs are a decision record, a live GitHub issue comment, and a future-agent knowledge note. `rg -n 'D124|Supported manual rereview trigger contract|@kodiai review|wired-but-unproven' .gsd/DECISIONS.md` confirmed that D124 was persisted with the expected supported-trigger wording. `gh issue view 84 -R xbmc/kodiai --comments --json comments --jq '.comments[-1] | {url: .url, author: .author.login, hasSupportedTrigger: (.body | contains("@kodiai review")), hasWiredButUnproven: (.body | contains("wired but unproven")), hasUiUnsupported: (.body | contains("Not yet a supported operator contract"))}'` confirmed the latest issue comment reflects the same operator guidance. `rg -n 'GitHub bot token helper is not usable in this environment|/Users/joel/.local/bin/secrets|gh api' .gsd/KNOWLEDGE.md` confirmed the environment-specific GitHub fallback note was recorded for future runs.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `rg -n 'D124|Supported manual rereview trigger contract|@kodiai review|wired-but-unproven' .gsd/DECISIONS.md` | 0 | ✅ pass | 3ms |
| 2 | `gh issue view 84 -R xbmc/kodiai --comments --json comments --jq '.comments[-1] | {url: .url, author: .author.login, hasSupportedTrigger: (.body | contains("@kodiai review")), hasWiredButUnproven: (.body | contains("wired but unproven")), hasUiUnsupported: (.body | contains("Not yet a supported operator contract"))}'` | 0 | ✅ pass | 818ms |
| 3 | `rg -n 'GitHub bot token helper is not usable in this environment|/Users/joel/.local/bin/secrets|gh api' .gsd/KNOWLEDGE.md` | 0 | ✅ pass | 3ms |

## Deviations

Used authenticated `gh api` instead of the `github-bot` skill’s token script because the script depends on `/Users/joel/.local/bin/secrets`, which is absent in this environment. The task output stayed the same: issue #84 was updated successfully.

## Known Issues

No fresh human-generated `pull_request.review_requested` delivery has been captured yet, so the `ai-review` / `aireview` UI rereview path remains wired-but-unproven until S02 either proves it end-to-end or removes it as a supported path.

## Files Created/Modified

- `.gsd/DECISIONS.md`
- `.gsd/KNOWLEDGE.md`
