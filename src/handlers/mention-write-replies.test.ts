import { describe, expect, test } from "bun:test";
import {
  buildIssueWriteFailureReply,
  buildIssueWriteSuccessReply,
  isLikelyWritePermissionFailure,
  summarizeErrorForDiagnostics,
} from "./mention-write-replies.ts";

describe("summarizeErrorForDiagnostics", () => {
  test("returns the first non-empty error signal", () => {
    expect(summarizeErrorForDiagnostics(new Error("branch push failed"))).toBe("branch push failed");
  });
});

describe("mention write replies", () => {
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
});
