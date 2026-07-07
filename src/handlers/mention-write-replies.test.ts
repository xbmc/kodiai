import { describe, expect, test } from "bun:test";
import {
  buildAlreadyAppliedReply,
  buildEmptyPatchReply,
  buildExistingPrReply,
  buildFallbackPatchGistReply,
  buildNoFileChangesReply,
  buildPatchGistReply,
  buildPatchTooLargeReply,
  buildPrContextRequiredReply,
  buildIssueWriteFailureReply,
  buildIssueWriteSuccessReply,
  buildUpdatedPrReply,
  buildWriteDisabledReply,
  buildWriteInProgressReply,
  buildWritePermissionFailureReply,
  buildWritePolicyRefusalReply,
  buildWriteRateLimitedReply,
  createIssueWriteFailurePoster,
  handleIssueWritePublishFailure,
  isLikelyWritePermissionFailure,
  maybeReplyWritePermissionFailure,
  summarizeErrorForDiagnostics,
} from "./mention-write-replies.ts";

describe("summarizeErrorForDiagnostics", () => {
  test("returns the first non-empty error signal", () => {
    expect(summarizeErrorForDiagnostics(new Error("branch push failed"))).toBe("branch push failed");
  });
});

describe("mention write replies", () => {
  test("builds common write-mode status replies", () => {
    expect(buildExistingPrReply({ prUrl: "https://github.com/acme/widgets/pull/1" })).toContain(
      "Existing PR: https://github.com/acme/widgets/pull/1",
    );
    expect(buildWriteInProgressReply()).toContain("Write request already in progress.");
    expect(buildWriteRateLimitedReply({ retryInSeconds: 12 })).toContain("Try again in 12s.");
    expect(buildPrContextRequiredReply()).toContain("I can only apply changes in a PR context.");
    expect(buildNoFileChangesReply()).toContain("I didn't end up making any file changes.");
    expect(buildEmptyPatchReply()).toContain("No diff content to create a patch from.");
    expect(buildPatchTooLargeReply()).toContain("too large to publish as a gist");
    expect(buildAlreadyAppliedReply({ prUrl: "https://github.com/acme/widgets/pull/2" })).toContain(
      "Already applied (idempotent): https://github.com/acme/widgets/pull/2",
    );
    expect(buildUpdatedPrReply({ prUrl: "https://github.com/acme/widgets/pull/3" })).toContain(
      "Updated PR: https://github.com/acme/widgets/pull/3",
    );
  });

  test("preserves legacy optional PR URL rendering for idempotent PR-head replies", () => {
    expect(buildAlreadyAppliedReply({ prUrl: undefined })).toContain("Already applied (idempotent): undefined");
    expect(buildUpdatedPrReply({ prUrl: undefined })).toContain("Updated PR: undefined");
  });

  test("builds dynamic write-mode remediation and gist replies", () => {
    const disabled = buildWriteDisabledReply({
      retryCommand: "@kodiai apply: fix docs",
    });
    expect(disabled).toContain("Write mode is disabled for this repo.");
    expect(disabled).toContain("Then re-run the same `@kodiai apply: fix docs` command.");

    const gist = buildPatchGistReply({
      gistUrl: "https://gist.github.com/acme/123",
      changedFiles: ["src/a.ts", "README.md"],
    });
    expect(gist).toContain("Patch gist: https://gist.github.com/acme/123");
    expect(gist).toContain("curl -sL https://gist.github.com/acme/123.patch | git apply");
    expect(gist).toContain("Files changed: src/a.ts, README.md");

    const fallbackGist = buildFallbackPatchGistReply({
      gistUrl: "https://gist.github.com/acme/456",
    });
    expect(fallbackGist).toContain("Could not create a PR from the fork");
    expect(fallbackGist).toContain("Patch gist: https://gist.github.com/acme/456");
    expect(fallbackGist).toContain("curl -sL https://gist.github.com/acme/456.patch | git apply");
  });

  test("wraps success and failure bodies in kodiai response details", () => {
    expect(buildIssueWriteSuccessReply({
      prUrl: "https://github.com/xbmc/kodiai/pull/1",
      issueLinkbackUrl: "https://github.com/xbmc/kodiai/issues/2#issuecomment-3",
    })).toContain("status: success");

    expect(buildIssueWriteFailureReply({
      failedStep: "create-pr",
      diagnostics: "permission denied",
      retryCommand: "apply: fix it",
    })).toContain("failed_step: create-pr");
  });

  test("detects likely GitHub write permission failures", () => {
    expect(isLikelyWritePermissionFailure({ status: 403 })).toBe(true);
    expect(isLikelyWritePermissionFailure(new Error("write access to repository not granted"))).toBe(true);
    expect(isLikelyWritePermissionFailure(new Error("timeout"))).toBe(false);
  });

  test("builds a permission remediation reply with the retry command", () => {
    const reply = buildWritePermissionFailureReply({
      retryCommand: "@kodiai apply: fix the docs",
    });

    expect(reply).toContain("<summary>kodiai response</summary>");
    expect(reply).toContain("missing GitHub App permissions");
    expect(reply).toContain("Contents: Read and write");
    expect(reply).toContain("Pull requests: Read and write");
    expect(reply).toContain("Issues: Read and write");
    expect(reply).toContain("@kodiai apply: fix the docs");
  });

  test("wraps write-policy refusals as kodiai responses", () => {
    const reply = buildWritePolicyRefusalReply({
      refusal: "Write policy rejected path `secrets.txt`.",
    });

    expect(reply).toContain("<summary>kodiai response</summary>");
    expect(reply).toContain("Write policy rejected path `secrets.txt`.");
  });

  test("posts permission remediation replies only for likely write permission failures", async () => {
    const posted: Array<{ body: string; options?: { sanitizeMentions?: boolean } }> = [];
    const postReply = async (body: string, options?: { sanitizeMentions?: boolean }) => {
      posted.push({ body, options });
    };

    await expect(maybeReplyWritePermissionFailure({
      err: { status: 403 },
      retryCommand: "@kodiai apply: fix it",
      postReply,
    })).resolves.toEqual({ ok: true, value: { status: "handled" } });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toContain("@kodiai apply: fix it");
    expect(posted[0]?.options).toEqual({ sanitizeMentions: false });

    await expect(maybeReplyWritePermissionFailure({
      err: new Error("timeout"),
      retryCommand: "@kodiai apply: fix it",
      postReply,
    })).resolves.toEqual({ ok: true, value: { status: "not-applicable" } });

    expect(posted).toHaveLength(1);
  });

  test("posts and logs issue write publish failures", async () => {
    const posted: Array<{ body: string; options?: { sanitizeMentions?: boolean } }> = [];
    const warnings: Array<{ fields: Record<string, unknown>; message?: string }> = [];
    const err = new Error("create PR failed");

    await expect(handleIssueWritePublishFailure({
      isIssueWritePublishFlow: true,
      failedStep: "create-pr",
      err,
      retryCommand: "@kodiai apply: fix it",
      postReply: async (body, options) => {
        posted.push({ body, options });
      },
      logger: {
        warn: (fields, message) => warnings.push({ fields, message }),
      },
      logContext: {
        deliveryId: "delivery-1",
        installationId: 123,
        owner: "acme",
        repoName: "widgets",
        repo: "acme/widgets",
        sourcePrNumber: undefined,
        triggerCommentId: 456,
        triggerCommentUrl: "https://github.com/acme/widgets/issues/7#issuecomment-456",
        writeOutputKey: "write-key",
      },
    })).resolves.toEqual({ ok: true, value: { status: "posted" } });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toContain("failed_step: create-pr");
    expect(posted[0]?.body).toContain("diagnostics: create PR failed");
    expect(posted[0]?.options).toEqual({ sanitizeMentions: false });
    expect(warnings).toEqual([{
      fields: {
        evidenceType: "write-mode",
        outcome: "pr_creation_failed",
        deliveryId: "delivery-1",
        installationId: 123,
        owner: "acme",
        repoName: "widgets",
        repo: "acme/widgets",
        sourcePrNumber: undefined,
        triggerCommentId: 456,
        triggerCommentUrl: "https://github.com/acme/widgets/issues/7#issuecomment-456",
        writeOutputKey: "write-key",
        failedStep: "create-pr",
        diagnostics: "create PR failed",
      },
      message: "Issue write-mode publish failed",
    }]);
  });

  test("creates an issue write failure poster with bound context", async () => {
    const posted: Array<{ body: string; options?: { sanitizeMentions?: boolean } }> = [];
    const warnings: Array<{ fields: Record<string, unknown>; message?: string }> = [];

    const postIssueWriteFailure = createIssueWriteFailurePoster({
      isIssueWritePublishFlow: true,
      retryCommand: "@kodiai apply: fix it",
      postReply: async (body, options) => {
        posted.push({ body, options });
      },
      logger: {
        warn: (fields, message) => warnings.push({ fields, message }),
      },
      logContext: {
        deliveryId: "delivery-1",
        installationId: 123,
        owner: "acme",
        repoName: "widgets",
        repo: "acme/widgets",
        triggerCommentId: 456,
        triggerCommentUrl: "https://github.com/acme/widgets/issues/7#issuecomment-456",
        writeOutputKey: "write-key",
      },
    });

    await expect(postIssueWriteFailure("branch-push", new Error("push failed")))
      .resolves.toEqual({ ok: true, value: { status: "posted" } });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toContain("failed_step: branch-push");
    expect(posted[0]?.body).toContain("diagnostics: push failed");
    expect(warnings[0]?.fields).toMatchObject({
      outcome: "pr_creation_failed",
      failedStep: "branch-push",
      diagnostics: "push failed",
    });
  });

  test("returns write publish failures outside issue write flow as Result errors", async () => {
    const err = new Error("branch push failed");

    await expect(handleIssueWritePublishFailure({
      isIssueWritePublishFlow: false,
      failedStep: "branch-push",
      err,
      retryCommand: "@kodiai apply: fix it",
      postReply: async () => {
        throw new Error("should not post");
      },
      logger: { warn: () => undefined },
      logContext: {
        deliveryId: "delivery-1",
        installationId: 123,
        owner: "acme",
        repoName: "widgets",
        repo: "acme/widgets",
        triggerCommentId: 456,
        triggerCommentUrl: "https://github.com/acme/widgets/pull/7#issuecomment-456",
        writeOutputKey: "write-key",
      },
    })).resolves.toEqual({ ok: false, err });
  });
});
