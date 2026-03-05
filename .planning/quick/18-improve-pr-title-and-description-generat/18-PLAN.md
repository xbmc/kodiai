---
phase: quick-18
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/handlers/mention-types.ts
  - src/handlers/mention.ts
  - src/handlers/mention.test.ts
autonomous: true
requirements: [QUICK-18]
must_haves:
  truths:
    - "Write-mode PRs have descriptive titles based on actual changes, not user request text"
    - "PR bodies contain a summary paragraph, changes list, and collapsed metadata"
    - "Issue title is available in MentionEvent for PR title generation"
    - "PR #27956 on xbmc/xbmc has a proper title and description"
  artifacts:
    - path: "src/handlers/mention-types.ts"
      provides: "issueTitle field on MentionEvent"
      contains: "issueTitle"
    - path: "src/handlers/mention.ts"
      provides: "Improved PR title/body generation using issue title and diff stats"
      contains: "generatePrTitle"
  key_links:
    - from: "src/handlers/mention-types.ts"
      to: "src/handlers/mention.ts"
      via: "MentionEvent.issueTitle consumed in PR creation"
      pattern: "mention\\.issueTitle"
---

<objective>
Improve PR title and description generation for write-mode PRs so they look like normal feature PRs in the target repo.

Purpose: Current PRs have titles like `chore(issue-27954): implement AVS2 support, make a PR` (parroting user request) and bodies that are just internal metadata. They should describe what the code actually does.
Output: Updated mention handler with proper PR title/body generation, and PR #27956 fixed on xbmc/xbmc.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/handlers/mention-types.ts
@src/handlers/mention.ts (lines 331-345 for summarizeWriteRequest, lines 1790-1910 for PR creation)
@src/handlers/mention.test.ts (lines 108-137 for buildIssueCommentMentionEvent, lines 3150-3217 for write intent test)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add issueTitle to MentionEvent and build PR title/body generator</name>
  <files>src/handlers/mention-types.ts, src/handlers/mention.ts, src/handlers/mention.test.ts</files>
  <action>
**1. Add issueTitle to MentionEvent (mention-types.ts):**
- Add `issueTitle: string | null` field to the MentionEvent interface (after `issueBody`)
- In `normalizeIssueComment`: set `issueTitle: payload.issue.title`
- In `normalizeReviewComment`: set `issueTitle: payload.pull_request.title`
- In `normalizeReviewBody`: set `issueTitle: payload.pull_request.title`

**2. Add generatePrTitle helper function (mention.ts, near summarizeWriteRequest):**
Create a new function `generatePrTitle(issueTitle: string | null, requestSummary: string, isFromPr: boolean): string` that:
- If issueTitle is available and not empty: derive the title from the issue title
  - Detect conventional commit prefix from the issue title content: if title mentions "fix"/"bug"/"crash" use `fix:`, if "refactor" use `refactor:`, if "add"/"support"/"implement"/"feature"/"new" use `feat:`, otherwise default to `feat:`
  - Clean the issue title: remove leading `[tags]` brackets, remove trailing issue references, trim
  - Format: `{prefix}: {cleaned issue title}` truncated to 72 chars
- If no issueTitle (fallback): use `feat: {requestSummary}` truncated to 72 chars
- For PR-sourced writes (isFromPr=true): use `fix:` as default prefix instead of `feat:`

**3. Add generatePrBody helper function (mention.ts):**
Create `generatePrBody(params: { summary: string; issueTitle: string | null; sourceUrl: string; triggerCommentUrl: string; deliveryId: string; headSha: string; isFromPr: boolean; issueNumber: number; prNumber: number | undefined; diffStat: string })` that builds:
```
{summary paragraph derived from issueTitle or requestSummary — standalone explanation}

## Changes

{diffStat — the `git diff --stat` output from workspace}

---

{If from issue: "Resolves #{issueNumber}" else "Related to #{prNumber}"}

<details>
<summary>Metadata</summary>

- Source: {sourceUrl}
- Trigger: {triggerCommentUrl}
- Delivery: {deliveryId}
- Commit: {headSha}

</details>
```

**4. Generate diff stat after push (mention.ts ~line 1861):**
After `createBranchCommitAndPush` succeeds, get diff stats:
```ts
const diffStat = (await $`git -C ${workspace.dir} diff --stat HEAD~1 HEAD`.quiet()).text().trim();
```
Use empty string fallback if it fails.

**5. Replace PR title/body construction (mention.ts lines 1862-1886):**
Replace the existing `requestSummary`/`prTitle`/`prBody` block with calls to the new helper functions:
```ts
const requestSummary = summarizeWriteRequest(writeIntent.request);
const prTitle = generatePrTitle(mention.issueTitle, requestSummary, mention.prNumber !== undefined);
const sourceUrl = mention.prNumber !== undefined
  ? `https://github.com/${mention.owner}/${mention.repo}/pull/${mention.prNumber}`
  : `https://github.com/${mention.owner}/${mention.repo}/issues/${mention.issueNumber}`;
const prBody = generatePrBody({
  summary: requestSummary,
  issueTitle: mention.issueTitle,
  sourceUrl,
  triggerCommentUrl,
  deliveryId: event.id,
  headSha: pushed.headSha,
  isFromPr: mention.prNumber !== undefined,
  issueNumber: mention.issueNumber,
  prNumber: mention.prNumber,
  diffStat,
});
```

**6. Update test (mention.test.ts):**
- Add `title: "Update the README heading"` to the `issue` object in `buildIssueCommentMentionEvent` (line 127)
- Accept the `issueTitle` param in the helper and pass through
- Update assertion on line 3202: change from `expect(createdPrTitle).toContain("chore(issue-77):")` to `expect(createdPrTitle).toMatch(/^feat: /)`
- Update assertion on line 3203: change from checking `Summary:` to checking for the issue title or a description paragraph
- Update assertion on line 3208: change from checking raw `Request:` to checking it appears inside the collapsed metadata details section
- Keep assertions for trigger comment URL, delivery ID, and source issue URL (these still exist, just inside details)
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && bun test src/handlers/mention.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>
    - MentionEvent has issueTitle field populated from webhook payload
    - PR titles use conventional commit prefix (feat:/fix:/refactor:) derived from content, not always "chore"
    - PR bodies have a summary paragraph, changes section with diff stat, issue reference, and collapsed metadata
    - All existing mention tests pass with updated assertions
  </done>
</task>

<task type="auto">
  <name>Task 2: Fix PR #27956 on xbmc/xbmc with proper title and body</name>
  <files></files>
  <action>
Use gh api to update PR #27956 on xbmc/xbmc:

**Title:** `feat: add AVS2/AVS3 codec support for video playback`

**Body:** Write a proper PR description. First, fetch the current PR to see what files were changed:
```bash
gh api repos/xbmc/xbmc/pulls/27956 --jq '.body, .changed_files, .additions, .deletions'
gh api repos/xbmc/xbmc/pulls/27956/files --jq '.[].filename'
```

Then update with:
```bash
gh api repos/xbmc/xbmc/pulls/27956 --method PATCH \
  --field title="feat: add AVS2/AVS3 codec support for video playback" \
  --field body="$(cat <<'BODY'
Add support for AVS2 (IEEE 1857.4) and AVS3 (IEEE 1857.10) video codec standards, enabling Kodi to recognize and play back media encoded with these Chinese audio/video coding standards.

## Changes

{list the actual files changed based on what gh api shows}

Resolves https://github.com/xbmc/xbmc/issues/27954

<details>
<summary>Metadata</summary>

- Source issue: https://github.com/xbmc/xbmc/issues/27954
- Generated by @kodiai

</details>
BODY
)"
```

Adapt the body based on the actual files changed in the PR. The body should read as a standalone description of the change.
  </action>
  <verify>
    <automated>gh api repos/xbmc/xbmc/pulls/27956 --jq '.title' 2>&1</automated>
  </verify>
  <done>
    - PR #27956 title is "feat: add AVS2/AVS3 codec support for video playback" (or similar descriptive title)
    - PR #27956 body has a summary paragraph, file changes, and collapsed metadata
  </done>
</task>

</tasks>

<verification>
- `bun test src/handlers/mention.test.ts` passes
- `bun test src/handlers/mention-types.test.ts` passes (if exists)
- PR #27956 on xbmc/xbmc has updated title and body
</verification>

<success_criteria>
- Write-mode PRs generate descriptive titles with proper conventional commit prefixes
- PR bodies are standalone-readable with summary, changes, issue reference, and collapsed metadata
- PR #27956 on xbmc/xbmc is fixed with a proper title and description
</success_criteria>

<output>
After completion, create `.planning/quick/18-improve-pr-title-and-description-generat/18-SUMMARY.md`
</output>
