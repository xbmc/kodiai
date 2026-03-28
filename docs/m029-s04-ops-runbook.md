# M029-S04 Ops Runbook: Re-generation, Re-publication & Proof Verification

This runbook documents the 5 operational steps an operator must complete before
`bun run verify:m029:s04 --json` can achieve a full live pass (all 5 checks non-skipped
and passing).

## Prerequisites

Set the following environment variables before running any step:

```sh
export DATABASE_URL="postgres://..."         # Required for Steps 1–2 and DB-gated checks
export GITHUB_APP_ID="..."                   # Required for Steps 3–4 and ISSUE-CLEAN check
export GITHUB_PRIVATE_KEY="..."              # PEM string, file path, or base64-encoded key
```

## Skip vs. Pass: What the Harness Reports

| Check | Required env | Skips when missing | Gates `overallPassed` |
|---|---|---|---|
| CONTENT-FILTER-REJECTS | none | never | yes |
| PROMPT-BANS-META | none | never | yes |
| NO-REASONING-IN-DB | `DATABASE_URL` | yes | yes |
| LIVE-PUBLISHED | `DATABASE_URL` | yes | yes |
| ISSUE-CLEAN | `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY` | yes | yes |

A **skipped** check does **not** cause `overallPassed: false` — it simply means the
infrastructure was unavailable. All non-skipped checks must pass.

---

## Step 1 — DB Cleanup: Delete Reasoning-Prose Rows

Remove any wiki update suggestions that begin with reasoning prose starters
(`I'll`, `Let me`, `I will`, `I need to`, `Looking at`). These are LLM
meta-commentary rows that slipped through before the S01 content filter was applied.

```sh
psql $DATABASE_URL -c "DELETE FROM wiki_update_suggestions \
  WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'"
```

**Verify:** The query should report `DELETE N` where N is the number of rows removed.
If N > 0, the content filter was not applied to these rows before storage.

---

## Step 2 — Re-generation: Produce New Suggestions with Fixed Pipeline

Re-run the wiki update generator. This run uses the fixed pipeline:
- S01 prompt fix: `buildVoicePreservingPrompt` with `## Output Contract` ban
- S01 content filter: `isReasoningProse` pre-storage check
- S02 heuristic threshold: `heuristic_score >= 3`

```sh
bun scripts/generate-wiki-updates.ts
```

**What to expect:** New rows in `wiki_update_suggestions` with no reasoning-prose
suggestions. If `DATABASE_URL` is set and LLM credentials are available, this
generates suggestions for all stale wiki pages above the heuristic threshold.

---

## Step 3 — Issue Cleanup: Remove Unmarked Comments from GitHub Issue #5

Before re-publishing, clean up any comments on `xbmc/wiki` issue #5 that lack the
`<!-- kodiai:wiki-modification:` marker. These are leftover manual or legacy comments
that would fail the ISSUE-CLEAN check.

**Dry run first (inspect what will be deleted):**

```sh
bun scripts/cleanup-wiki-issue.ts \
  --owner xbmc \
  --repo wiki \
  --issue-number 5 \
  --dry-run
```

**Execute the cleanup:**

```sh
bun scripts/cleanup-wiki-issue.ts \
  --owner xbmc \
  --repo wiki \
  --issue-number 5 \
  --no-dry-run
```

**What to expect:** Comments without the marker are deleted. Comments that already
have `<!-- kodiai:wiki-modification:` or contain `# Wiki Modification Artifacts`
(the summary table) are preserved.

---

## Step 4 — Re-publication: Post Updated Suggestions to Issue #5

Publish the freshly generated suggestions to `xbmc/wiki` issue #5. Each published
comment gets the `<!-- kodiai:wiki-modification:` marker and the row's `published_at`
timestamp is set.

```sh
bun scripts/publish-wiki-updates.ts --issue-number 5
```

**What to expect:** New comments appear on issue #5 with the modification marker.
Rows in `wiki_update_suggestions` gain `published_at IS NOT NULL`. The summary table
(`# Wiki Modification Artifacts`) is posted or updated.

---

## Step 5 — Proof: Run the Harness

With DB and GitHub credentials in the environment, run the harness and verify all 5
checks pass:

```sh
bun run verify:m029:s04 --json
```

**Expected output:**

```json
{
  "check_ids": [
    "M029-S04-CONTENT-FILTER-REJECTS",
    "M029-S04-PROMPT-BANS-META",
    "M029-S04-NO-REASONING-IN-DB",
    "M029-S04-LIVE-PUBLISHED",
    "M029-S04-ISSUE-CLEAN"
  ],
  "overallPassed": true,
  "checks": [
    { "id": "M029-S04-CONTENT-FILTER-REJECTS", "passed": true, "skipped": false, "status_code": "content_filter_rejects" },
    { "id": "M029-S04-PROMPT-BANS-META",       "passed": true, "skipped": false, "status_code": "prompt_bans_meta" },
    { "id": "M029-S04-NO-REASONING-IN-DB",     "passed": true, "skipped": false, "status_code": "no_reasoning_in_db" },
    { "id": "M029-S04-LIVE-PUBLISHED",         "passed": true, "skipped": false, "status_code": "live_published" },
    { "id": "M029-S04-ISSUE-CLEAN",            "passed": true, "skipped": false, "status_code": "issue_clean" }
  ]
}
```

Exit code 0 means `overallPassed: true`. Exit code 1 means at least one non-skipped
check failed.

---

## Failure Diagnostics

**Surface failing checks:**

```sh
bun run verify:m029:s04 --json 2>&1 | jq '.checks[] | select(.passed == false)'
```

**Inspect residual reasoning-prose rows:**

```sql
SELECT id, suggestion FROM wiki_update_suggestions
WHERE suggestion ~* '^(I''ll|Let me|I will|I need to|Looking at)'
ORDER BY created_at DESC
LIMIT 20;
```

**Inspect published rows:**

```sql
SELECT id, page_id, published_at, published_comment_id
FROM wiki_update_suggestions
WHERE published_at IS NOT NULL
ORDER BY published_at DESC
LIMIT 20;
```

**Re-run Steps 1–4** if any DB or GitHub check fails after the initial run.
