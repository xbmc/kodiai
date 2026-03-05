---
phase: quick-20
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/handlers/mention.ts
  - src/slack/write-runner.ts
autonomous: true
requirements: [QUICK-20]
must_haves:
  truths:
    - "PR branch push commits use conventional-commit format with descriptive subject"
    - "Bot PR commits use conventional-commit format with descriptive subject"
    - "Slack write commits use conventional-commit format with request summary"
    - "Metadata trailers (idempotency marker, deliveryId, source) remain in commit body"
  artifacts:
    - path: "src/handlers/mention.ts"
      provides: "generateCommitSubject helper and updated commit messages at lines ~1814 and ~1947"
      contains: "generateCommitSubject"
    - path: "src/slack/write-runner.ts"
      provides: "Descriptive commit subject using summarizeWriteRequest"
  key_links:
    - from: "src/handlers/mention.ts:~1814"
      to: "generateCommitSubject"
      via: "function call replacing hardcoded string"
      pattern: "generateCommitSubject"
    - from: "src/handlers/mention.ts:~1947"
      to: "generateCommitSubject"
      via: "function call replacing hardcoded string"
      pattern: "generateCommitSubject"
---

<objective>
Replace generic "kodiai: apply requested changes" commit messages with descriptive conventional-commit-format subjects.

Purpose: Commit messages should describe WHAT changed, not just that something changed. This makes git log useful for understanding repo history.
Output: All 3 commit message sites produce messages like `fix: handle null check in parser (#27954)` instead of `kodiai: apply requested changes (issue #27954)`.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/handlers/mention.ts (lines 371-418: summarizeWriteRequest, generatePrTitle — reuse this prefix detection logic)
@src/handlers/mention.ts (lines 1811-1819: PR branch push commit message — site 1)
@src/handlers/mention.ts (lines 1942-1952: bot PR creation commit message — site 2)
@src/slack/write-runner.ts (lines 78-84: summarizeWriteRequest, lines 228-235: commit message — site 3)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add generateCommitSubject helper and update mention.ts commit sites</name>
  <files>src/handlers/mention.ts</files>
  <action>
Add a `generateCommitSubject` function near `generatePrTitle` (after line ~418). It reuses the same prefix detection logic from `generatePrTitle` but formats for commit subjects:

```typescript
function generateCommitSubject(params: {
  issueTitle: string | null | undefined;
  requestSummary: string;
  isFromPr: boolean;
  ref?: string; // e.g. "#27954" or "PR #42"
}): string {
  const maxLen = 72;
  const { issueTitle, requestSummary, isFromPr, ref } = params;

  let subject: string;

  if (issueTitle && issueTitle.trim().length > 0) {
    const cleaned = issueTitle
      .replace(/^\[.*?\]\s*/g, "")
      .replace(/\s*#\d+\s*$/, "")
      .trim();

    const lower = cleaned.toLowerCase();
    let prefix: string;
    if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
      prefix = "fix";
    } else if (/\brefactor\b/.test(lower)) {
      prefix = "refactor";
    } else if (/\b(?:add|support|implement|feature|new)\b/.test(lower)) {
      prefix = "feat";
    } else {
      prefix = isFromPr ? "fix" : "feat";
    }
    subject = `${prefix}: ${cleaned}`;
  } else {
    const defaultPrefix = isFromPr ? "fix" : "feat";
    subject = `${defaultPrefix}: ${requestSummary}`;
  }

  // Append ref if provided
  if (ref) {
    const withRef = `${subject} (${ref})`;
    if (withRef.length <= maxLen) {
      subject = withRef;
    }
    // If adding ref would exceed maxLen, truncate subject part to fit
    else {
      const refSuffix = ` (${ref})`;
      const available = maxLen - refSuffix.length - 3; // 3 for "..."
      if (available > 10) {
        subject = `${subject.slice(0, available).trimEnd()}...${refSuffix}`;
      }
      // else just truncate without ref
    }
  }

  return subject.length <= maxLen ? subject : `${subject.slice(0, maxLen - 3).trimEnd()}...`;
}
```

Then update the two commit message sites:

**Site 1 (~line 1814, PR branch push):** Replace the hardcoded subject. Before this block, add `const requestSummary = summarizeWriteRequest(writeIntent.request);` (it's not yet computed at this point). Then:
```typescript
const commitSubject = generateCommitSubject({
  issueTitle: mention.issueTitle,
  requestSummary,
  isFromPr: true,
  ref: `PR #${mention.prNumber}`,
});
const commitMessage = [
  commitSubject,
  "",
  idempotencyMarker,
  `deliveryId: ${event.id}`,
].join("\n");
```

**Site 2 (~line 1947, bot PR creation):** Replace the hardcoded subject. The `requestSummary` is already computed at line 2031, but site 2 is BEFORE that. Add `const commitRequestSummary = summarizeWriteRequest(writeIntent.request);` before the commit message. Then:
```typescript
const sourceRef = mention.prNumber !== undefined
  ? `PR #${mention.prNumber}`
  : `#${mention.issueNumber}`;
const commitSubject = generateCommitSubject({
  issueTitle: mention.issueTitle,
  requestSummary: commitRequestSummary,
  isFromPr: mention.prNumber !== undefined,
  ref: sourceRef,
});
const commitMessage = [
  commitSubject,
  "",
  `kodiai-write-output-key: ${writeOutputKey}`,
  `deliveryId: ${event.id}`,
].join("\n");
```

IMPORTANT: Do NOT rename the existing `requestSummary` at line 2031 — use a different variable name (`commitRequestSummary`) to avoid shadowing or breaking the PR title/body generation that follows.

Keep all metadata trailers (idempotency marker, deliveryId, write-output-key) in the commit body (lines after the blank line) — only the first line (subject) changes.
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Both commit message sites in mention.ts produce descriptive conventional-commit subjects instead of generic "kodiai: apply requested changes" text. Metadata trailers preserved in body.</done>
</task>

<task type="auto">
  <name>Task 2: Update slack write-runner commit message</name>
  <files>src/slack/write-runner.ts</files>
  <action>
Update the commit message at line ~230 in `src/slack/write-runner.ts`. The `requestSummary` is already computed at line 229. Replace:

```typescript
const commitMessage = [
  `kodiai: apply slack write request`,
  "",
  `source: slack channel ${input.channel} thread ${input.threadTs}`,
  `request: ${requestSummary}`,
].join("\n");
```

With:

```typescript
// Derive prefix from request content (same heuristic as mention handler)
const lower = requestSummary.toLowerCase();
let prefix: string;
if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
  prefix = "fix";
} else if (/\brefactor\b/.test(lower)) {
  prefix = "refactor";
} else {
  prefix = "feat";
}
const commitSubject = `${prefix}: ${requestSummary}`;
const maxSubjectLen = 72;
const truncatedSubject = commitSubject.length <= maxSubjectLen
  ? commitSubject
  : `${commitSubject.slice(0, maxSubjectLen - 3).trimEnd()}...`;

const commitMessage = [
  truncatedSubject,
  "",
  `source: slack channel ${input.channel} thread ${input.threadTs}`,
  `request: ${requestSummary}`,
].join("\n");
```

This keeps the full request in a trailer for traceability while making the subject line descriptive.
  </action>
  <verify>
    <automated>cd /home/keith/src/kodiai && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Slack write-runner commits produce descriptive `feat: <summary>` or `fix: <summary>` subjects instead of generic "kodiai: apply slack write request".</done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes with no errors
2. `bun test` passes (no regressions)
3. Grep confirms no remaining "kodiai: apply requested changes" or "kodiai: apply slack write request" hardcoded strings
</verification>

<success_criteria>
- All 3 commit message sites produce conventional-commit-format subjects (prefix: description)
- Issue/PR references included in parentheses where available
- Metadata trailers preserved in commit body (not lost)
- No "kodiai: apply" hardcoded strings remain in commit subject lines
- TypeScript compiles cleanly, existing tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/20-improve-commit-message-quality-guideline/20-SUMMARY.md`
</output>
