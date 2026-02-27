import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validateIssue,
  generateGuidanceComment,
  generateLabelRecommendation,
  generateGenericNudge,
} from "./triage-agent.ts";
import type { TriageValidationResult } from "./types.ts";

describe("validateIssue", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "triage-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeTemplate(filename: string, content: string) {
    const templateDir = path.join(tmpDir, ".github", "ISSUE_TEMPLATE");
    await mkdir(templateDir, { recursive: true });
    await writeFile(path.join(templateDir, filename), content, "utf-8");
  }

  const bugTemplate = `---
name: Bug Report
labels: bug
---

## Description
<!-- A clear description of the bug -->

## Steps to Reproduce
<!-- Steps to reproduce the behavior -->

## Expected Behavior
<!-- What you expected to happen -->

## Screenshots
<!-- optional -->
<!-- Add screenshots if applicable -->
`;

  it("returns valid result when all required sections present", async () => {
    await writeTemplate("bug-report.md", bugTemplate);

    const result = await validateIssue({
      workspaceDir: tmpDir,
      issueBody: `## Description
A real bug exists in the login flow.

## Steps to Reproduce
1. Open app
2. Click login
3. See error

## Expected Behavior
Should log in successfully.
`,
    });

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(true);
    expect(result!.templateSlug).toBe("bug-report");
    expect(result!.templateName).toBe("Bug Report");
  });

  it("returns invalid result when required sections missing", async () => {
    await writeTemplate("bug-report.md", bugTemplate);

    const result = await validateIssue({
      workspaceDir: tmpDir,
      issueBody: `## Description
Some description.
`,
    });

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);

    const stepsSection = result!.sections.find(
      (s) => s.heading === "Steps to Reproduce",
    );
    expect(stepsSection?.status).toBe("missing");
  });

  it("returns null when issue body matches no template", async () => {
    await writeTemplate("bug-report.md", bugTemplate);

    const result = await validateIssue({
      workspaceDir: tmpDir,
      issueBody: `## Totally Random Section
Some content that doesn't match any template.

## Another Random Section
More content.
`,
    });

    expect(result).toBeNull();
  });

  it("returns null for null issue body", async () => {
    await writeTemplate("bug-report.md", bugTemplate);

    const result = await validateIssue({
      workspaceDir: tmpDir,
      issueBody: null,
    });

    expect(result).toBeNull();
  });

  it("returns null for empty issue body", async () => {
    await writeTemplate("bug-report.md", bugTemplate);

    const result = await validateIssue({
      workspaceDir: tmpDir,
      issueBody: "",
    });

    expect(result).toBeNull();
  });

  it("returns null when no ISSUE_TEMPLATE directory exists", async () => {
    const result = await validateIssue({
      workspaceDir: tmpDir,
      issueBody: "## Description\nSome text",
    });

    expect(result).toBeNull();
  });

  it("selects best-fit template when multiple exist", async () => {
    await writeTemplate("bug-report.md", bugTemplate);

    const featureTemplate = `---
name: Feature Request
labels: enhancement
---

## Summary
<!-- Summarize the feature -->

## Motivation
<!-- Why do you want this? -->

## Proposed Solution
<!-- How should it work? -->
`;
    await writeTemplate("feature-request.md", featureTemplate);

    // Issue body matches feature request template better
    const result = await validateIssue({
      workspaceDir: tmpDir,
      issueBody: `## Summary
Add dark mode support.

## Motivation
Users want it.

## Proposed Solution
Use CSS variables.
`,
    });

    expect(result).not.toBeNull();
    expect(result!.templateSlug).toBe("feature-request");
    expect(result!.valid).toBe(true);
  });

  it("detects empty sections in issue body", async () => {
    await writeTemplate("bug-report.md", bugTemplate);

    const result = await validateIssue({
      workspaceDir: tmpDir,
      issueBody: `## Description
N/A

## Steps to Reproduce
1. Real steps

## Expected Behavior
Should work.
`,
    });

    expect(result).not.toBeNull();
    expect(result!.valid).toBe(false);
    const descSection = result!.sections.find(
      (s) => s.heading === "Description",
    );
    expect(descSection?.status).toBe("empty");
  });
});

describe("generateGuidanceComment", () => {
  it("produces bulleted list for missing sections", () => {
    const result: TriageValidationResult = {
      templateSlug: "bug-report",
      templateName: "Bug Report",
      valid: false,
      sections: [
        { heading: "Description", status: "present", hint: "A clear description", required: true },
        { heading: "Steps to Reproduce", status: "missing", hint: "Steps to reproduce the behavior", required: true },
        { heading: "Expected Behavior", status: "empty", hint: "What you expected", required: true },
        { heading: "Screenshots", status: "missing", hint: null, required: false },
      ],
    };

    const comment = generateGuidanceComment(result);
    expect(comment).toContain("Thanks for filing!");
    expect(comment).toContain("**Steps to Reproduce**");
    expect(comment).toContain("This section is missing");
    expect(comment).toContain("**Expected Behavior**");
    expect(comment).toContain("This section looks empty");
    // Should NOT include present section
    expect(comment).not.toContain("**Description**");
    // Should NOT include optional missing section
    expect(comment).not.toContain("**Screenshots**");
  });

  it("includes hints from template", () => {
    const result: TriageValidationResult = {
      templateSlug: "bug-report",
      templateName: "Bug Report",
      valid: false,
      sections: [
        { heading: "Description", status: "missing", hint: "A clear description of the bug", required: true },
      ],
    };

    const comment = generateGuidanceComment(result);
    expect(comment).toContain("A clear description of the bug");
  });

  it("returns empty string when all required sections present", () => {
    const result: TriageValidationResult = {
      templateSlug: "bug-report",
      templateName: "Bug Report",
      valid: true,
      sections: [
        { heading: "Description", status: "present", hint: null, required: true },
        { heading: "Steps", status: "present", hint: null, required: true },
      ],
    };

    expect(generateGuidanceComment(result)).toBe("");
  });

  it("handles section with no hint", () => {
    const result: TriageValidationResult = {
      templateSlug: "bug-report",
      templateName: "Bug Report",
      valid: false,
      sections: [
        { heading: "Custom Section", status: "missing", hint: null, required: true },
      ],
    };

    const comment = generateGuidanceComment(result);
    expect(comment).toContain("**Custom Section**: This section is missing");
    // No trailing " -- " since there's no hint
    expect(comment).not.toContain(" -- ");
  });
});

describe("generateLabelRecommendation", () => {
  const invalidResult: TriageValidationResult = {
    templateSlug: "bug-report",
    templateName: "Bug Report",
    valid: false,
    sections: [
      { heading: "Description", status: "missing", hint: null, required: true },
    ],
  };

  const validResult: TriageValidationResult = {
    templateSlug: "bug-report",
    templateName: "Bug Report",
    valid: true,
    sections: [
      { heading: "Description", status: "present", hint: null, required: true },
    ],
  };

  it("returns convention-based label when invalid + empty allowlist", () => {
    const label = generateLabelRecommendation({
      result: invalidResult,
      labelAllowlist: [],
    });
    expect(label).toBe("needs-info:bug-report");
  });

  it("returns label when in allowlist", () => {
    const label = generateLabelRecommendation({
      result: invalidResult,
      labelAllowlist: ["needs-info:bug-report", "needs-info:feature"],
    });
    expect(label).toBe("needs-info:bug-report");
  });

  it("returns label when allowlist has prefix match", () => {
    const label = generateLabelRecommendation({
      result: invalidResult,
      labelAllowlist: ["needs-info:"],
    });
    expect(label).toBe("needs-info:bug-report");
  });

  it("returns null when allowlist excludes the label", () => {
    const label = generateLabelRecommendation({
      result: invalidResult,
      labelAllowlist: ["needs-info:feature"],
    });
    expect(label).toBeNull();
  });

  it("returns null when result is valid", () => {
    const label = generateLabelRecommendation({
      result: validResult,
      labelAllowlist: [],
    });
    expect(label).toBeNull();
  });
});

describe("generateGenericNudge", () => {
  it("returns a non-empty string", () => {
    const nudge = generateGenericNudge();
    expect(nudge.length).toBeGreaterThan(0);
  });

  it("mentions templates", () => {
    const nudge = generateGenericNudge();
    expect(nudge.toLowerCase()).toContain("template");
  });

  it("does not mention specific template names", () => {
    const nudge = generateGenericNudge();
    expect(nudge).not.toContain("bug-report");
    expect(nudge).not.toContain("feature-request");
  });
});
