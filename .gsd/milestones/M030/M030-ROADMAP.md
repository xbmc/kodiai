# M030: 

## Vision
When a PR is opened or updated on xbmc/repo-plugins, xbmc/repo-scripts, or xbmc/repo-scrapers, Kodiai automatically runs kodi-addon-checker against the affected addon directories and posts a structured PR comment listing violations — same style as existing reviews, updated on each push.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | Handler scaffold and repo detection | low | — | ✅ | After this: handler fires on a repo-plugins PR and logs the addon IDs it would check; non-addon repos produce no output. |
| S02 | kodi-addon-checker subprocess and output parsing | high | S01 | ⬜ | After this: given a workspace with a bad addon, structured findings are returned from the runner — visible in test output and logs. |
| S03 | PR comment posting and idempotency | low | S01, S02 | ⬜ | After this: full end-to-end works — PR on repo-plugins gets a Kodiai addon-check comment, updated on re-push. |
