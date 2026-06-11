import { describe, expect, test } from "bun:test";
import { renderReviewInstructionSections, type ReviewInstructionSection } from "./review-instruction-budget.ts";

describe("renderReviewInstructionSections", () => {
  test("drops low-retention sections before high-retention review contracts", () => {
    const sections: ReviewInstructionSection[] = [
      {
        id: "active-rules",
        lines: ["## Generated Review Rules", "low ".repeat(500)],
      },
      {
        id: "core-rules",
        lines: ["## Rules", "Only actionable issues."],
      },
      {
        id: "after-review-standard",
        lines: ["## After review", "If NO issues found: do nothing."],
      },
    ];

    const rendered = renderReviewInstructionSections(sections, 120);
    const text = rendered.lines.join("\n");

    expect(rendered.budgetOutcome?.status).toBe("trimmed");
    expect(rendered.budgetOutcome!.includedChars).toBeLessThanOrEqual(rendered.budgetOutcome!.budgetChars);
    expect(text).not.toContain("## Generated Review Rules");
    expect(text).toContain("## Rules");
    expect(text).toContain("## After review");
  });

  test("degrades instead of throwing when high-retention contracts exceed budget", () => {
    const sections: ReviewInstructionSection[] = [{
      id: "core-rules",
      lines: ["## Rules", "This required core contract is intentionally too long. ".repeat(20)],
    }];

    const rendered = renderReviewInstructionSections(sections, 80);

    expect(rendered.budgetOutcome?.status).toBe("trimmed");
    expect(rendered.budgetOutcome?.includedChars).toBe(80);
    expect(rendered.lines.join("\n").length).toBeLessThanOrEqual(80);
  });

  test("degrades instead of dropping hard behavioral controls", () => {
    const sections: ReviewInstructionSection[] = [
      {
        id: "active-rules",
        lines: ["## Generated Review Rules", "low ".repeat(500)],
      },
      {
        id: "comment-cap",
        lines: ["Limit findings to 7 comments."],
      },
      {
        id: "confidence-threshold",
        lines: ["Only report findings above the configured confidence threshold."],
      },
      {
        id: "tool-availability",
        lines: ["Use the configured publishing tools exactly as described."],
      },
      {
        id: "core-rules",
        lines: ["## Rules", "Only actionable issues."],
      },
      {
        id: "after-review-standard",
        lines: ["## After review", "If NO issues found: do nothing."],
      },
    ];

    const rendered = renderReviewInstructionSections(sections, 150);
    const text = rendered.lines.join("\n");

    expect(rendered.budgetOutcome?.status).toBe("trimmed");
    expect(text).not.toContain("## Generated Review Rules");
    expect(text).toContain("Use the configured publishing tools");
    expect(text.length).toBeLessThanOrEqual(150);
  });

  test("uses canonical instruction order for rendering", () => {
    const sections: ReviewInstructionSection[] = [
      { id: "after-review-standard", lines: ["## After review"] },
      { id: "core-rules", lines: ["## Rules"] },
    ];

    expect(renderReviewInstructionSections(sections).lines.join("\n")).toBe(
      "## Rules\n\n## After review",
    );
  });
});
