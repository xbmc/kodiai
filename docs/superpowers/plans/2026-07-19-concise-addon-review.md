# Concise Kodi Add-on Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic Python reviews on configured Kodi add-on repositories with one concise, diff-grounded add-on compliance comment containing Summary, Findings, and an advisory Verdict.

**Architecture:** Gate the generic handler before it starts review work, then make the existing specialized add-on flow consume GitHub patch metadata instead of checked-out full-file content. Keep deterministic and LLM review separate, synthesize their validated results with bounded checker evidence, and let a pure formatter derive the public verdict.

**Tech Stack:** TypeScript, Bun test runner, Octokit pull-request file metadata, existing Kodiai job/workspace abstractions, existing LLM routing, ESLint, Docker.

---

## File structure

- `src/handlers/review-addon-repo-gate.ts`: pure early routing decision for generic reviews.
- `src/handlers/review-addon-repo-gate.test.ts`: automatic and non-add-on routing cases.
- `src/handlers/review-handler-dependencies.ts`: optional configured add-on repository dependency with an empty default.
- `src/handlers/review.ts`: apply the add-on gate before resolving generic review runtime.
- `src/index.ts`: pass configured add-on repositories into the generic review handler.
- `src/lib/addon-rule-context.ts`: convert GitHub file metadata into bounded patch-only add-on evidence.
- `src/lib/addon-rule-context.test.ts`: prove no workspace/full-file read is possible.
- `src/lib/addon-rule-deterministic.ts`: branch, changed-path, and changed-manifest checks over diff evidence.
- `src/lib/addon-rule-deterministic.test.ts`: invalid branch, new-license, and diff-only rule cases.
- `src/lib/addon-rule-types.ts`: structured summary, finding evidence, and incompleteness types.
- `src/lib/addon-rule-llm.ts`: exclusive-scope prompt and bounded structured response parser.
- `src/lib/addon-rule-llm.test.ts`: prompt and parser safety contract.
- `src/lib/addon-rule-review.ts`: merge deterministic and model results and provide deterministic fallback summary.
- `src/lib/addon-rule-review.test.ts`: synthesis, fallback, and incomplete-state cases.
- `src/lib/addon-check-formatter.ts`: one concise public Summary/Findings/Verdict comment.
- `src/lib/addon-check-formatter.test.ts`: exact clean, finding, and timeout output.
- `src/handlers/addon-check.ts`: pass branch and patch metadata into review and stop silently skipping invalid branches.
- `src/handlers/addon-check.test.ts`: end-to-end specialized routing and comment publication.
- `CHANGELOG.md`: note contributor-facing behavior in the next release section.

### Task 1: Skip generic review for configured add-on repositories

**Files:**
- Create: `src/handlers/review-addon-repo-gate.ts`
- Create: `src/handlers/review-addon-repo-gate.test.ts`
- Modify: `src/handlers/review-handler-dependencies.ts`
- Modify: `src/handlers/review.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing pure gate tests**

```ts
import { describe, expect, test } from "bun:test";
import { evaluateGenericReviewAddonRepoGate } from "./review-addon-repo-gate.ts";

describe("evaluateGenericReviewAddonRepoGate", () => {
  test("skips a configured addon repository case-insensitively", () => {
    expect(evaluateGenericReviewAddonRepoGate({
      repositoryFullName: "XBMC/Repo-Scripts",
      addonRepos: ["xbmc/repo-scripts"],
    })).toEqual({ action: "skip", reason: "specialized-addon-review" });
  });

  test("continues generic review for all other repositories", () => {
    expect(evaluateGenericReviewAddonRepoGate({
      repositoryFullName: "xbmc/xbmc",
      addonRepos: ["xbmc/repo-scripts"],
    })).toEqual({ action: "continue" });
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `bun test src/handlers/review-addon-repo-gate.test.ts`

Expected: FAIL because `review-addon-repo-gate.ts` does not exist.

- [ ] **Step 3: Implement the gate and wire it before generic runtime resolution**

```ts
export function evaluateGenericReviewAddonRepoGate(params: {
  repositoryFullName: string | undefined;
  addonRepos: readonly string[];
}): { action: "continue" } | { action: "skip"; reason: "specialized-addon-review" } {
  const repo = params.repositoryFullName?.trim().toLowerCase();
  if (!repo) return { action: "continue" };
  return params.addonRepos.some((candidate) => candidate.trim().toLowerCase() === repo)
    ? { action: "skip", reason: "specialized-addon-review" }
    : { action: "continue" };
}
```

Add `addonRepos?: readonly string[]` to review handler dependencies, resolve it to `[]`, and call the gate at the top of `handleReview` using `payload.repository?.full_name`. Log a bounded skip reason and return before `resolveReviewEventRuntime`. Pass `config.addonRepos` from application setup.

- [ ] **Step 4: Add a handler regression test proving no generic executor/workspace work starts**

Use the existing review-handler test harness with an `xbmc/repo-scripts` opened payload, `addonRepos: ["xbmc/repo-scripts"]`, and spies that throw if workspace creation or executor execution occurs. Assert neither spy is called.

- [ ] **Step 5: Run routing tests and confirm GREEN**

Run: `bun test src/handlers/review-addon-repo-gate.test.ts src/handlers/review.test.ts -t "specialized addon review|evaluateGenericReviewAddonRepoGate"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/review-addon-repo-gate.ts src/handlers/review-addon-repo-gate.test.ts src/handlers/review-handler-dependencies.ts src/handlers/review.ts src/handlers/review.test.ts src/index.ts
git commit -m "Route addon repositories away from generic review"
```

### Task 2: Replace full-file context with bounded patch evidence

**Files:**
- Modify: `src/lib/addon-rule-context.ts`
- Modify: `src/lib/addon-rule-context.test.ts`

- [ ] **Step 1: Replace context tests with the desired patch-only contract**

```ts
const contexts = collectAddonRuleContext({
  files: [{
    filename: "script.example/default.py",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-old()\n+new()",
  }],
});

expect(contexts[0]?.files[0]).toEqual({
  path: "script.example/default.py",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: "@@ -1 +1 @@\n-old()\n+new()",
});
```

Also test that non-content files retain path/status metadata without content, missing GitHub patches become `omittedReason: "patch-unavailable"`, patches are capped at 40,000 characters with `omittedReason: "truncated"`, and root files do not create add-on contexts.

- [ ] **Step 2: Run the context tests and confirm RED**

Run: `bun test src/lib/addon-rule-context.test.ts`

Expected: FAIL because the collector still requires a workspace and reads full head files.

- [ ] **Step 3: Implement a synchronous metadata-only collector**

```ts
export type AddonRuleFileContext = {
  path: string;
  status?: string;
  additions?: number | null;
  deletions?: number | null;
  patch?: string;
  omittedReason?: "out-of-scope" | "patch-unavailable" | "truncated";
};

export function collectAddonRuleContext(params: {
  files: readonly PullRequestFileMetadata[];
  maxPatchChars?: number;
}): AddonRuleAddonContext[];
```

Remove all filesystem imports and `workspaceDir`. Keep patch content only for `addon.xml`, `.py`, and `.js`; retain changed paths for deterministic filename rules.

- [ ] **Step 4: Run context tests and confirm GREEN**

Run: `bun test src/lib/addon-rule-context.test.ts`

Expected: PASS and the module has no `Bun.file`, `readdir`, or workspace path access.

- [ ] **Step 5: Commit**

```bash
git add src/lib/addon-rule-context.ts src/lib/addon-rule-context.test.ts
git commit -m "Limit addon review context to PR patches"
```

### Task 3: Make deterministic checks diff-aware and validate target branches

**Files:**
- Modify: `src/lib/addon-rule-deterministic.ts`
- Modify: `src/lib/addon-rule-deterministic.test.ts`
- Modify: `src/lib/addon-rule-types.ts`

- [ ] **Step 1: Write failing branch and license-scope tests**

```ts
expect(runDeterministicAddonRuleChecks({
  baseBranch: "master",
  contexts: [context({ addonId: "script.example" })],
})).toContainEqual(expect.objectContaining({
  level: "ERROR",
  rule: "target-branch",
  message: expect.stringContaining("master"),
}));

expect(runDeterministicAddonRuleChecks({
  baseBranch: "nexus",
  contexts: [context({
    addonId: "script.example",
    allChangedPaths: ["script.example/addon.xml"],
    files: [{ path: "script.example/addon.xml", status: "modified", patch: "@@ ..." }],
  })],
})).not.toContainEqual(expect.objectContaining({ rule: "license-file" }));
```

Add a new-addon case where `addon.xml` is added without a changed license and must produce `license-file`, plus valid `matrix`, `nexus`, and `omega` cases and a forward-compatible lowercase Kodi-codename case supplied through an explicit allowed-branches input.

- [ ] **Step 2: Run deterministic tests and confirm RED**

Run: `bun test src/lib/addon-rule-deterministic.test.ts`

Expected: FAIL because checks accept only contexts, inspect head license state, and have no branch finding.

- [ ] **Step 3: Add evidence fields and diff-aware checks**

```ts
export type AddonRuleFinding = {
  addonId: string;
  path?: string;
  rule: string;
  level: "ERROR" | "WARN";
  source: "deterministic" | "llm";
  message: string;
};

export function runDeterministicAddonRuleChecks(params: {
  baseBranch: string;
  validBranches: readonly string[];
  contexts: readonly AddonRuleAddonContext[];
}): AddonRuleFinding[];
```

Treat `master`, `main`, unknown branches, and pre-`matrix` branches as target-branch errors. Only report a missing license when an added `addon.xml` establishes a new add-on and no license path is added in that add-on's diff. Parse `addon.xml` patch-added lines conservatively; do not infer unchanged tags as passing or failing.

- [ ] **Step 4: Run deterministic tests and confirm GREEN**

Run: `bun test src/lib/addon-rule-deterministic.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/addon-rule-types.ts src/lib/addon-rule-deterministic.ts src/lib/addon-rule-deterministic.test.ts
git commit -m "Make addon rules diff aware"
```

### Task 4: Return a bounded summary and concrete findings from the model

**Files:**
- Modify: `src/lib/addon-rule-llm.ts`
- Modify: `src/lib/addon-rule-llm.test.ts`
- Modify: `src/lib/addon-rule-review.ts`
- Create: `src/lib/addon-rule-review.test.ts`

- [ ] **Step 1: Write failing prompt and parser tests**

Assert the prompt contains all of these exact constraints:

```ts
expect(prompt).toContain("Review only the supplied diff patches");
expect(prompt).toContain("Do not review Python or JavaScript correctness, syntax, logic, style, architecture, or maintainability");
expect(prompt).toContain('"summary"');
expect(prompt).toContain('"path"');
expect(prompt).not.toContain("Full changed files are provided");
```

Parse `{ summary, findings }`, truncate nothing silently, and reject a response when summary exceeds 600 characters, findings exceed 20, a message exceeds 400 characters, a path is not present in the corresponding add-on context, or unsafe prompt/backlink text appears.

- [ ] **Step 2: Run LLM tests and confirm RED**

Run: `bun test src/lib/addon-rule-llm.test.ts`

Expected: FAIL because the current output contains findings only and uses preference wording.

- [ ] **Step 3: Implement the structured result contract**

```ts
export type AddonRuleLlmResult = {
  summary?: string;
  findings: AddonRuleFinding[];
  rejectedSummary?: true;
};

export function parseAddonRuleReviewOutput(
  text: string,
  contexts: readonly AddonRuleAddonContext[],
): AddonRuleLlmResult;
```

The JSON contract is:

```json
{
  "summary": "One to three factual sentences grounded in the patches.",
  "findings": [{
    "addonId": "script.example",
    "path": "script.example/default.py",
    "rule": "executable-files",
    "level": "ERROR",
    "message": "The changed code runs a downloaded executable."
  }]
}
```

Force `source: "llm"`, validate changed paths, and reject unsafe values.

- [ ] **Step 4: Write synthesis tests**

Cover a valid model summary, rejected/missing summary fallback, deterministic plus model finding merge, duplicate removal, LLM timeout, no scoped patches, and missing/truncated patch incompleteness.

- [ ] **Step 5: Implement review synthesis**

Change `RunAddonRuleLlm` to return `AddonRuleLlmResult`. Make `runAddonRuleReview` accept `baseBranch`, `validBranches`, and pull-request file metadata instead of `workspaceDir`. Build a deterministic summary such as:

```ts
`Reviewed ${addonIds.length} changed add-on(s) for ${baseBranch}; ${scopedPatchCount} scoped patch(es) were available.`
```

Return bounded `incompleteReasons` using a closed union: `rules-fallback`, `llm-incomplete`, `patch-unavailable`, `patch-truncated`, and `checker-incomplete`.

- [ ] **Step 6: Run prompt and synthesis tests and confirm GREEN**

Run: `bun test src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/addon-rule-llm.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.ts src/lib/addon-rule-review.test.ts src/lib/addon-rule-types.ts
git commit -m "Add structured addon review summaries"
```

### Task 5: Render one concise Summary, Findings, and advisory Verdict

**Files:**
- Modify: `src/lib/addon-check-formatter.ts`
- Modify: `src/lib/addon-check-formatter.test.ts`

- [ ] **Step 1: Write exact-output formatter tests**

For a clean complete review, assert equality with:

```markdown
<!-- kodiai:addon-check:xbmc/repo-scripts:2862 -->
## Kodiai Add-on Review

### Summary

`script.audiooffsetmanager` updates from 1.5.0 to 2.1.0 on the valid `nexus` target branch.

### Findings

No addon-rule violations were found in the reviewed diff.

### Verdict

No addon-rule violations found. Final approval remains with a human reviewer.
```

Add exact tests for two concrete bullets and `Needs human review: 1 error and 1 warning found.` Add a timeout case containing one caveat and prove it excludes `Mode:`, `Reason codes:`, `240000ms`, redaction prose, and source/provenance columns.

- [ ] **Step 2: Run formatter tests and confirm RED**

Run: `bun test src/lib/addon-check-formatter.test.ts`

Expected: FAIL because the formatter still emits separate checker/rule sections and operational diagnostics.

- [ ] **Step 3: Implement the pure concise formatter**

Keep the current function entry point and marker. Merge public checker findings and rule findings, count only `ERROR`/`WARN`, render escaped bullet values, and derive verdict text in code. Always include the human-approval sentence. Render at most one bounded incompleteness sentence after Summary.

- [ ] **Step 4: Run formatter tests and confirm GREEN**

Run: `bun test src/lib/addon-check-formatter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/addon-check-formatter.ts src/lib/addon-check-formatter.test.ts
git commit -m "Publish concise addon review comments"
```

### Task 6: Integrate patch review and invalid-branch publication in the handler

**Files:**
- Modify: `src/handlers/addon-check.ts`
- Modify: `src/handlers/addon-check.test.ts`

- [ ] **Step 1: Write failing handler tests**

Add cases proving:

- An opened clean add-on PR publishes one Summary/Findings/Verdict comment.
- A `master` target publishes a target-branch finding instead of returning without a comment.
- The injected LLM input contains GitHub patches and no workspace/full-file content.
- A checker timeout produces one concise caveat.
- A synchronized event keeps the last rule summary while rerunning checker behavior, or uses a deterministic summary without invoking the LLM.
- The same marker updates the existing comment.

- [ ] **Step 2: Run targeted handler tests and confirm RED**

Run: `bun test src/handlers/addon-check.test.ts -t "concise addon review|invalid addon target|patch-only addon review"`

Expected: FAIL against the current handler.

- [ ] **Step 3: Remove the invalid-branch early return and integrate the new contracts**

Pass `baseBranch`, the supported post-`matrix` branch list, and `files` into `runAddonRuleReview`. Run `kodi-addon-checker` only when the checker branch resolves. For invalid branches, synthesize a bounded checker-incomplete state and continue through formatter publication. Do not pass `workspaceDir` into add-on context collection or the LLM.

Filter checker findings for public display using changed paths and manifest evidence; retain complete checker counts in structured logs. Preserve cleanup, queue behavior, publication pipeline, and marker upsert.

- [ ] **Step 4: Run handler and all add-on tests and confirm GREEN**

Run:

```bash
bun test \
  src/handlers/addon-check.test.ts \
  src/handlers/review-addon-repo-gate.test.ts \
  src/lib/addon-checker-runner.test.ts \
  src/lib/addon-check-classification.test.ts \
  src/lib/addon-check-formatter.test.ts \
  src/lib/addon-rule-context.test.ts \
  src/lib/addon-rule-deterministic.test.ts \
  src/lib/addon-rule-llm.test.ts \
  src/lib/addon-rule-review.test.ts \
  src/lib/addon-rule-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/addon-check.ts src/handlers/addon-check.test.ts
git commit -m "Integrate concise patch based addon reviews"
```

### Task 7: Release note and build verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the release note**

Under the current unreleased release heading, add:

```markdown
- Add-on submissions now receive one concise, diff-grounded Summary/Findings/Verdict review; configured add-on repositories no longer run the generic Python code-quality reviewer.
```

- [ ] **Step 2: Run type checking and scoped lint**

Run:

```bash
bunx tsc --noEmit
bunx eslint \
  src/handlers/review-addon-repo-gate.ts \
  src/handlers/review-handler-dependencies.ts \
  src/handlers/review.ts \
  src/handlers/addon-check.ts \
  src/lib/addon-rule-context.ts \
  src/lib/addon-rule-deterministic.ts \
  src/lib/addon-rule-llm.ts \
  src/lib/addon-rule-review.ts \
  src/lib/addon-check-formatter.ts \
  src/index.ts
```

Expected: both exit 0.

- [ ] **Step 3: Run the complete targeted regression set**

Run the test command from Task 6 plus `src/handlers/mention.test.ts` and the targeted generic review-handler routing test.

Expected: PASS with no unhandled errors or warnings.

- [ ] **Step 4: Build the application artifact**

Run: `build_dir=$(mktemp -d) && bun build src/index.ts --target=bun --outdir "$build_dir" && test -s "$build_dir/index.js"`

Expected: Bun reports a successful bundle and `index.js` is non-empty.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "Document concise addon review output"
```

- [ ] **Step 6: Record final evidence**

Run: `git status --short && git log --oneline -8`

Expected: clean worktree and focused implementation commits following the design commit.
