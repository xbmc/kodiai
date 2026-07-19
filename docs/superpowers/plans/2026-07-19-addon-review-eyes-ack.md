# Add-on Review Eyes Acknowledgement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure an accepted `@kodiai review` in a configured add-on repository receives one best-effort eyes reaction before specialized review dispatch.

**Architecture:** Thread a narrow acknowledgement callback from the mention handler through request preparation into the existing add-on routing boundary. Invoke it only after the route has confirmed the repository is configured and fetched the PR identity, immediately before dispatching the synthetic add-on review event; leave the normal mention acknowledgement path unchanged.

**Tech Stack:** TypeScript, Bun test, Octokit reactions API, Azure Container Apps deployment via `deploy.sh`.

---

## File Structure

- Modify `src/handlers/mention.test.ts` to reproduce the missing reaction and assert reaction-before-dispatch ordering.
- Modify `src/handlers/mention.ts` to supply the existing best-effort reaction helper as the specialized-route acknowledgement callback.
- Modify `src/handlers/mention-request-preparation.ts` to accept and forward that callback.
- Modify `src/handlers/addon-review-routing.ts` to invoke the callback immediately before specialized dispatch.

### Task 1: Reproduce the Missing Acknowledgement

**Files:**
- Test: `src/handlers/mention.test.ts:7803`

- [ ] **Step 1: Extend the existing specialized add-on routing test**

Add a call-order array and capture the reaction parameters:

```ts
const callOrder: string[] = [];
const issueCommentReactionCalls: unknown[] = [];

createForIssueComment: async (params: unknown) => {
  callOrder.push("eyes");
  issueCommentReactionCalls.push(params);
  return { data: {} };
},

addonReviewDispatcher: async (event) => {
  callOrder.push("dispatch");
  dispatchedAddonEvents.push(event);
},
```

After invoking the handler, assert:

```ts
expect(issueCommentReactionCalls).toEqual([{
  owner: "acme",
  repo: "repo",
  comment_id: 779,
  content: "eyes",
}]);
expect(callOrder).toEqual(["eyes", "dispatch"]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test src/handlers/mention.test.ts --test-name-pattern "@kodiai review in addon repos routes"
```

Expected: FAIL because `issueCommentReactionCalls` is empty and the observed call order contains only `dispatch`.

### Task 2: Acknowledge Before Specialized Dispatch

**Files:**
- Modify: `src/handlers/mention.ts:30-35,185-196`
- Modify: `src/handlers/mention-request-preparation.ts:25-70`
- Modify: `src/handlers/addon-review-routing.ts:12-52`
- Test: `src/handlers/mention.test.ts:7803`

- [ ] **Step 1: Add the acknowledgement hook to the add-on routing boundary**

Extend `routeAddonRuleReviewMention` parameters:

```ts
beforeDispatch: () => Promise<void>;
```

After `getPullRequest` succeeds, insert this immediately before the existing `await params.dispatch(...)` call:

```ts
await params.beforeDispatch();
```

- [ ] **Step 2: Forward the callback through request preparation**

Extend `prepareMentionRequestExecutionContext` parameters:

```ts
acknowledgeAddonReview: () => Promise<void>;
```

Pass it into the routing call:

```ts
beforeDispatch: params.acknowledgeAddonReview,
```

- [ ] **Step 3: Bind the existing best-effort eyes helper in the mention handler**

Import `postMentionEyesReaction` from `./mention-reactions.ts` and add this parameter when preparing the request:

```ts
acknowledgeAddonReview: () => postMentionEyesReaction({
  octokit,
  mention,
  logger,
}),
```

Do not remove or move the existing normal-path call in `runMentionPrePromptGates`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
bun test src/handlers/mention.test.ts --test-name-pattern "@kodiai review in addon repos routes"
```

Expected: 1 pass, 0 fail, with reaction parameters and `eyes` before `dispatch`.

- [ ] **Step 5: Run adjacent acknowledgement and routing tests**

Run:

```bash
bun test src/handlers/mention-reactions.test.ts src/handlers/addon-review-routing.test.ts src/handlers/mention.test.ts --test-name-pattern "eyes|addon repos routes|configured addon"
```

Expected: all selected tests pass with zero failures.

### Task 3: Verify, Commit, and Deploy

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the production fix**

Add an Unreleased bullet stating that explicit add-on review mentions now receive an eyes acknowledgement before specialized dispatch.

- [ ] **Step 2: Run static and build verification**

Run:

```bash
bun run lint
bunx tsc --noEmit
build_dir=$(mktemp -d)
bun build src/index.ts --target=bun --outdir "$build_dir"
git diff --check
```

Expected: lint, bundle build, and diff check exit 0. If typecheck reports the known `src/jobs/aca-launcher.test.ts(344,70)` baseline error, reproduce it on `consolidated-review-fixes` and report it rather than modifying unrelated code.

- [ ] **Step 3: Run the full unit suite**

Run:

```bash
bun run test:unit
```

Expected: all feature-related tests pass. If the known conversational PR-diff test remains the only failure and reproduces on `consolidated-review-fixes`, record that baseline evidence.

- [ ] **Step 4: Commit the tested fix**

```bash
git add CHANGELOG.md src/handlers/mention.test.ts src/handlers/mention.ts src/handlers/mention-request-preparation.ts src/handlers/addon-review-routing.ts
git commit -m "Acknowledge specialized addon reviews"
```

- [ ] **Step 5: Run deploy preflight and deploy the exact commit**

Confirm the current Azure revision is healthy and no agent job is running, then run:

```bash
ENV_FILE=/home/keith/src/kodiai/.env DEPLOY_SOURCE_COMMIT=$(git rev-parse HEAD) ./deploy.sh
```

Expected: both ACR builds succeed and a new `ca-kodiai--deploy-<commit>-<timestamp>` revision becomes active.

- [ ] **Step 6: Verify live Azure provenance and health**

Assert that the active 100%-traffic revision and latest-ready revision match, the app and agent job `SOURCE_COMMIT` values equal the committed fix, `/healthz` returns `status=ok`, and `/readiness` returns `status=ready`.

- [ ] **Step 7: Verify the GitHub acknowledgement path**

Use a fresh explicit add-on review comment or an explicitly approved redelivery. Verify that the trigger comment receives exactly one eyes reaction and that the canonical add-on review comment is updated. Do not claim live reaction verification from deployment health alone.
