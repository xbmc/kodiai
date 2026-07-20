# Explicit Add-on Review Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a full response after each explicit Kodi add-on review request, retain complete patches up to 80,000 characters, and show diff-validated line numbers where available.

**Architecture:** Automatic PR events retain the PR-scoped canonical marker, while synthetic explicit-review events use a delivery-scoped marker passed through the existing publication pipeline. Add-on patch context remains bounded at a higher per-file limit, and optional model-provided right-side lines are checked against added lines parsed from the supplied unified diff before formatting.

**Tech Stack:** TypeScript, Bun test runner, Octokit issue-comment APIs, unified diff parsing, existing Kodiai publication pipeline, Azure Container Apps.

## Global Constraints

- Explicit `addon_rule_review.requested` events use `kodiai:addon-review-request:<synthetic-delivery-id>` markers.
- Automatic `pull_request.opened` and `pull_request.synchronize` events retain `kodiai:addon-check:<owner>/<repo>:<pr-number>` markers.
- A retry of one explicit delivery updates its prior response; a later explicit delivery creates a separate response.
- The marker-idempotent publication transaction retries transient GitHub failures before returning a non-fatal handler error.
- The per-file patch cap is exactly 80,000 characters; larger patches remain explicitly incomplete.
- A finding line is published only when it is a positive integer matching an added right-side line in that finding's supplied patch.
- File-level or unverifiable findings remain path-only.
- Existing eyes acknowledgement, specialized-review routing, advisory verdict, generic-review bypass, sanitization, and non-fatal error behavior remain unchanged.
- Production deployment is pinned to the exact verified source commit.

---

### Task 1: Publish Explicit Reviews with Delivery-scoped Markers

**Files:**
- Modify: `src/lib/addon-check-formatter.ts`
- Modify: `src/handlers/addon-check.ts`
- Test: `src/handlers/addon-check.test.ts`

**Interfaces:**
- Produces: `buildAddonReviewRequestMarker(deliveryId: string): string`.
- Changes: `upsertAddonCheckComment(params)` requires `marker: string` and uses it for lookup.
- Consumes: `WebhookEvent.name` and `WebhookEvent.id` at handler publication time.

- [ ] **Step 1: Write failing response-marker tests**

Import `buildAddonReviewRequestMarker`, add a `makeAddonRuleReviewEvent(deliveryId)` helper by cloning `makePrEvent` with `name: "addon_rule_review"` and `action: "requested"`, and add tests asserting:

```ts
const canonical = buildAddonCheckMarker("xbmc", "repo-plugins", 42);
const response = buildAddonReviewRequestMarker("delivery-mention-1:addon-rule-review");
expect(response).toBe("<!-- kodiai:addon-review-request:delivery-mention-1:addon-rule-review -->");
```

For direct upsert retry coverage, seed one comment containing `response`, call `upsertAddonCheckComment` with `marker: response`, and expect update of that comment with no create. For handler coverage, seed only a canonical comment, dispatch the `addon_rule_review.requested` handler, and expect one create, no update, the response marker rather than the canonical marker, and `Summary`, `Findings`, and `Verdict`. Dispatch two distinct event IDs against a fixture with no response comments and expect two created bodies with distinct delivery-scoped markers.

- [ ] **Step 2: Run the response tests and confirm RED**

Run: `bun test src/handlers/addon-check.test.ts`

Expected: FAIL because the response marker builder and caller-selected marker parameter do not exist.

- [ ] **Step 3: Implement marker selection and marker-directed upsert**

Add to `src/lib/addon-check-formatter.ts`:

```ts
export const ADDON_REVIEW_REQUEST_MARKER_PREFIX = "kodiai:addon-review-request";

export function buildAddonReviewRequestMarker(deliveryId: string): string {
  return `<!-- ${ADDON_REVIEW_REQUEST_MARKER_PREFIX}:${deliveryId} -->`;
}
```

Add `marker: string` to `upsertAddonCheckComment`, remove its internally reconstructed marker, and pass a selected marker from the handler:

```ts
const marker = event.name === "addon_rule_review"
  ? buildAddonReviewRequestMarker(event.id)
  : buildAddonCheckMarker(owner, repoName, prNumber);
```

Use the same `marker` for `formatAddonCheckComment` and `upsertAddonCheckComment`. Update existing direct-upsert tests to pass the canonical marker explicitly.

- [ ] **Step 4: Run focused response and routing tests and confirm GREEN**

Run: `bun test src/handlers/addon-check.test.ts src/handlers/addon-review-routing.test.ts src/handlers/mention.test.ts`

Expected: PASS, including eyes-before-dispatch and generic-review bypass coverage.

- [ ] **Step 5: Commit the response publication slice**

```bash
git add src/lib/addon-check-formatter.ts src/handlers/addon-check.ts src/handlers/addon-check.test.ts
git commit -m "Publish explicit addon review responses"
```

### Task 2: Retain Complete Add-on Patches up to 80,000 Characters

**Files:**
- Modify: `src/lib/addon-rule-context.ts`
- Test: `src/lib/addon-rule-context.test.ts`
- Test: `src/lib/addon-rule-review.test.ts`

**Interfaces:**
- Produces: `MAX_ADDON_RULE_PATCH_CHARS = 80_000` as the collector's default per-file bound.
- Preserves: `omittedReason: "truncated"` for patches exceeding that bound.

- [ ] **Step 1: Write failing boundary and completeness tests**

Add context tests that pass a 53,089-character Python patch and expect the entire patch with no `omittedReason`, then pass an 80,001-character patch and expect a patch of length 80,000 with `omittedReason: "truncated"`.

Add a review test using a 53,089-character Python patch, wiki rules, and a stub LLM result; assert `incompleteReasons` does not contain `patch-truncated`.

- [ ] **Step 2: Run the context and review tests and confirm RED**

Run: `bun test src/lib/addon-rule-context.test.ts src/lib/addon-rule-review.test.ts`

Expected: FAIL because the current default cap is 40,000 characters.

- [ ] **Step 3: Implement the exact bounded limit**

In `src/lib/addon-rule-context.ts`, add and use:

```ts
export const MAX_ADDON_RULE_PATCH_CHARS = 80_000;

const maxPatchChars = params.maxPatchChars ?? MAX_ADDON_RULE_PATCH_CHARS;
```

Keep existing slicing and `omittedReason: "truncated"` behavior unchanged above the bound.

- [ ] **Step 4: Run the context and review tests and confirm GREEN**

Run: `bun test src/lib/addon-rule-context.test.ts src/lib/addon-rule-review.test.ts`

Expected: PASS at 53,089 and at the 80,000/80,001 boundary.

- [ ] **Step 5: Commit the patch-completeness slice**

```bash
git add src/lib/addon-rule-context.ts src/lib/addon-rule-context.test.ts src/lib/addon-rule-review.test.ts
git commit -m "Retain larger addon review patches"
```

### Task 3: Validate and Render Finding Line Numbers

**Files:**
- Modify: `src/lib/addon-rule-types.ts`
- Modify: `src/lib/addon-rule-llm.ts`
- Modify: `src/lib/addon-rule-review.ts`
- Modify: `src/lib/addon-check-formatter.ts`
- Test: `src/lib/addon-rule-llm.test.ts`
- Test: `src/lib/addon-check-formatter.test.ts`

**Interfaces:**
- Changes: `AddonRuleFinding` gains `line?: number`.
- Produces: internal unified-diff added-line validation in `parseAddonRuleReviewOutput`.
- Changes: formatted finding locations become `path:line` only for validated lines.

- [ ] **Step 1: Write failing parser and formatter tests**

Use this multi-line context patch:

```ts
patch: "@@ -10,2 +20,3 @@\n context\n-old()\n+new()\n+track_usage()\n context",
```

Parse one finding with `line: 21` and expect it retained. Parse equivalent findings with `line: 20`, `line: 0`, a decimal, a string, a path without a patch, and a deleted-side coordinate; expect each finding retained without `line`. Update the prompt test to require explicit instructions for a `line` containing the new-file/right-side added-line number.

Add formatter coverage:

```ts
expect(body).toContain("`plugin.video.foo/default.py:21`");
expect(pathOnlyBody).toContain("`plugin.video.foo/LICENSE`");
```

- [ ] **Step 2: Run parser and formatter tests and confirm RED**

Run: `bun test src/lib/addon-rule-llm.test.ts src/lib/addon-check-formatter.test.ts`

Expected: FAIL because the finding contract, prompt, validator, and renderer lack line support.

- [ ] **Step 3: Implement right-side added-line validation**

Add `line?: number` to `AddonRuleFinding`. Extend the prompt JSON example and instructions with `line` for line-specific findings.

In `src/lib/addon-rule-llm.ts`, parse unified diff hunks using headers matching:

```ts
/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/
```

Track the right-side line counter: increment for context and added lines, do not increment for deleted lines, ignore `\\ No newline at end of file`, and collect only added-line coordinates. Accept `finding.line` only when it is an integer greater than zero and the changed path's supplied patch contains that coordinate in its added-line set. Omit an invalid line without rejecting the otherwise valid finding.

Include `line` in finding deduplication keys in `src/lib/addon-rule-review.ts` and `src/lib/addon-check-formatter.ts`.

- [ ] **Step 4: Render validated locations**

In `src/lib/addon-check-formatter.ts`, include `line` in `PublicFinding` and build the location as:

```ts
const path = finding.path ?? finding.addonId;
const location = escapeInlineCode(finding.line ? `${path}:${finding.line}` : path);
```

- [ ] **Step 5: Run line-number tests and the add-on regression set and confirm GREEN**

Run: `bun test src/lib/addon-rule-llm.test.ts src/lib/addon-check-formatter.test.ts src/lib/addon-rule-review.test.ts src/handlers/addon-check.test.ts`

Expected: PASS with validated line rendering and path-only fallback.

- [ ] **Step 6: Commit the line-number slice**

```bash
git add src/lib/addon-rule-types.ts src/lib/addon-rule-llm.ts src/lib/addon-rule-review.ts src/lib/addon-check-formatter.ts src/lib/addon-rule-llm.test.ts src/lib/addon-check-formatter.test.ts
git commit -m "Add validated addon finding lines"
```

### Task 4: Verify, Deploy, and Prove the Live Review

**Files:**
- Verify: all files changed in Tasks 1-3
- Deploy: existing `deploy.sh` with `/home/keith/src/kodiai/.env`

**Interfaces:**
- Consumes: the exact implementation commit after Tasks 1-3.
- Produces: an Azure revision whose application and agent report that exact source commit.

- [ ] **Step 1: Run static, bundle, and focused verification**

```bash
git diff --check HEAD~3 HEAD
bun run lint
bunx tsc --noEmit
bun build src/index.ts --outdir /tmp/kodiai-explicit-review-build --target bun
bun test src/lib/addon-rule-context.test.ts src/lib/addon-rule-llm.test.ts src/lib/addon-rule-review.test.ts src/lib/addon-check-formatter.test.ts src/handlers/addon-check.test.ts src/handlers/addon-review-routing.test.ts src/handlers/mention.test.ts
```

Expected: diff check, lint, build, and focused tests pass. Reproduce any unchanged TypeScript failure on `/home/keith/src/kodiai` before classifying it as baseline.

- [ ] **Step 2: Run the full unit suite**

Run: `bun run test:unit`

Expected: all change-related tests pass. Reproduce any failure on `/home/keith/src/kodiai` before reporting it as baseline.

- [ ] **Step 3: Deploy the exact clean commit**

After `git status --short` is empty, capture `git rev-parse HEAD` as `DEPLOY_SOURCE_COMMIT` and run:

```bash
ENV_FILE=/home/keith/src/kodiai/.env DEPLOY_SOURCE_COMMIT="$DEPLOY_SOURCE_COMMIT" ./deploy.sh
```

Expected: a healthy Azure Container Apps revision pinned to that commit.

- [ ] **Step 4: Verify Azure and live GitHub behavior**

Confirm the active revision is ready and both application and agent health payloads report `DEPLOY_SOURCE_COMMIT`. Redeliver the GitHub App webhook for comment `5016821386`, then inspect PR `xbmc/repo-scripts#2861`.

Expected: exactly one bot eyes reaction on the trigger; one new structured response after it; no `patch-truncated` incomplete caveat for the 53,089-character patch; validated findings use `path:line` where available; canonical comment `5011592514` is not overwritten; replaying the same webhook updates the response without duplication.

- [ ] **Step 5: Report immutable evidence**

Report the implementation commit, Azure revision, health/readiness, new response URL, comment ordering, line-number examples, retry idempotency, focused test result, full-suite result, and independently reproduced baseline failures.
