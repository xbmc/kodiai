import { describe, expect, test } from "bun:test";
import { buildMentionAgentInstructions } from "./mention-agent-instructions.ts";

describe("buildMentionAgentInstructions", () => {
  test("returns plan-only instructions without write or publication permissions", () => {
    const result = buildMentionAgentInstructions({
      isPlanOnly: true,
      isWriteRequest: false,
      writeEnabled: false,
    });

    expect(result.planOnlyInstructions).toContain("Plan-only request detected (plan:).");
    expect(result.planOnlyInstructions).toContain("- Do NOT edit files.");
    expect(result.planOnlyInstructions).toContain("- Do NOT run git commands.");
    expect(result.planOnlyInstructions).toContain("- Do NOT propose opening a PR.");
    expect(result.planOnlyInstructions).toContain("End by asking whether they want you to implement the plan next.");
    expect(result.planOnlyInstructions).not.toContain("Write-intent request detected");
    expect(result.writeInstructions).toBeUndefined();
  });

  test("returns write-mode instructions with fork policy and fabrication safeguards", () => {
    const result = buildMentionAgentInstructions({
      isPlanOnly: false,
      isWriteRequest: true,
      writeEnabled: true,
    });

    expect(result.planOnlyInstructions).toBeUndefined();
    expect(result.writeInstructions).toContain("Write-intent request detected (apply/change).");
    expect(result.writeInstructions).toContain("Write-mode is enabled.");
    expect(result.writeInstructions).toContain("- Do NOT run git commands (no branch/commit/push).");
    expect(result.writeInstructions).toContain("- Do NOT publish any GitHub comments/reviews; publish tools are disabled.");
    expect(result.writeInstructions).toContain("NEVER fabricate checksums");
    expect(result.writeInstructions).toContain("SHA512=TODO_REPLACE_WITH_REAL_HASH");
    expect(result.writeInstructions).toContain("IMPORTANT: Branch and push policy:");
  });

  test("returns confirmation-plan instructions for disabled write requests", () => {
    const result = buildMentionAgentInstructions({
      isPlanOnly: false,
      isWriteRequest: true,
      writeEnabled: false,
    });

    expect(result.planOnlyInstructions).toBeUndefined();
    expect(result.writeInstructions).toContain("Write-intent request detected (apply/change).");
    expect(result.writeInstructions).toContain("do NOT create branches/commits/PRs and do NOT push changes");
    expect(result.writeInstructions).toContain("propose a concrete, minimal plan");
    expect(result.writeInstructions).toContain("ask for confirmation");
    expect(result.writeInstructions).not.toContain("Write-mode is enabled.");
  });

  test("returns no extra instructions for read-only non-plan mentions", () => {
    expect(
      buildMentionAgentInstructions({
        isPlanOnly: false,
        isWriteRequest: false,
        writeEnabled: false,
      }),
    ).toEqual({
      planOnlyInstructions: undefined,
      writeInstructions: undefined,
    });
  });
});
