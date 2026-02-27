import { describe, it, expect } from "bun:test";
import { parseTemplate, diffAgainstTemplate } from "./template-parser.ts";

describe("parseTemplate", () => {
  it("extracts full YAML frontmatter (name, labels)", () => {
    const content = `---
name: Bug Report
about: Report a bug
labels: bug, needs-triage
assignees: ''
---

## Description
<!-- A clear description of the bug -->

## Steps to Reproduce
<!-- Steps to reproduce the behavior -->
`;
    const result = parseTemplate("bug-report", content);
    expect(result.slug).toBe("bug-report");
    expect(result.name).toBe("Bug Report");
    expect(result.labels).toEqual(["bug", "needs-triage"]);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].heading).toBe("Description");
    expect(result.sections[1].heading).toBe("Steps to Reproduce");
  });

  it("handles labels as YAML array with brackets", () => {
    const content = `---
name: Feature Request
labels: [enhancement, feature]
---

## Summary
`;
    const result = parseTemplate("feature-request", content);
    expect(result.labels).toEqual(["enhancement", "feature"]);
  });

  it("handles labels with quotes", () => {
    const content = `---
name: Bug
labels: 'bug', "needs-triage"
---

## Description
`;
    const result = parseTemplate("bug", content);
    expect(result.labels).toEqual(["bug", "needs-triage"]);
  });

  it("falls back to slug when no frontmatter", () => {
    const content = `## Description
<!-- Describe the issue -->

## Steps
<!-- How to reproduce -->
`;
    const result = parseTemplate("my-template", content);
    expect(result.name).toBe("my-template");
    expect(result.labels).toEqual([]);
    expect(result.sections).toHaveLength(2);
  });

  it("extracts section headings as required by default", () => {
    const content = `---
name: Bug
labels: bug
---

## Description
<!-- A clear description -->

## Expected Behavior
<!-- What you expected -->

## Screenshots
<!-- If applicable -->
`;
    const result = parseTemplate("bug", content);
    expect(result.sections).toHaveLength(3);
    expect(result.sections.every((s) => s.required)).toBe(true);
  });

  it("marks sections with <!-- optional --> as not required", () => {
    const content = `---
name: Bug
labels: bug
---

## Description
<!-- A clear description -->

## Screenshots
<!-- optional -->
<!-- Add screenshots if applicable -->
`;
    const result = parseTemplate("bug", content);
    expect(result.sections[0].required).toBe(true);
    expect(result.sections[1].required).toBe(false);
  });

  it("extracts hint from HTML comments (not the optional marker)", () => {
    const content = `---
name: Bug
labels: bug
---

## Description
<!-- A clear description of the bug -->

## Screenshots
<!-- optional -->
<!-- Add screenshots if applicable -->
`;
    const result = parseTemplate("bug", content);
    expect(result.sections[0].hint).toBe("A clear description of the bug");
    // For optional section, hint should be the non-optional comment
    expect(result.sections[1].hint).toBe("Add screenshots if applicable");
  });

  it("returns empty sections array for template with no headings", () => {
    const content = `---
name: Blank
labels: []
---

This template has no section headings.
`;
    const result = parseTemplate("blank", content);
    expect(result.sections).toEqual([]);
  });

  it("handles optional marker case-insensitively", () => {
    const content = `## Screenshots
<!-- OPTIONAL -->
`;
    const result = parseTemplate("test", content);
    expect(result.sections[0].required).toBe(false);
  });

  it("handles frontmatter with no labels field", () => {
    const content = `---
name: Simple
about: A simple template
---

## Description
`;
    const result = parseTemplate("simple", content);
    expect(result.labels).toEqual([]);
  });
});

describe("diffAgainstTemplate", () => {
  const template = parseTemplate(
    "bug-report",
    `---
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
`,
  );

  it("returns valid when all required sections present and non-empty", () => {
    const issueBody = `## Description
This is a real bug description with details.

## Steps to Reproduce
1. Go to settings
2. Click save
3. See error

## Expected Behavior
It should save without errors.
`;
    const result = diffAgainstTemplate(template, issueBody);
    expect(result.valid).toBe(true);
    expect(result.templateSlug).toBe("bug-report");
    expect(result.templateName).toBe("Bug Report");

    const descSection = result.sections.find((s) => s.heading === "Description");
    expect(descSection?.status).toBe("present");
  });

  it("returns invalid when a required section is missing", () => {
    const issueBody = `## Description
Some description here.

## Expected Behavior
It should work.
`;
    const result = diffAgainstTemplate(template, issueBody);
    expect(result.valid).toBe(false);

    const stepsSection = result.sections.find(
      (s) => s.heading === "Steps to Reproduce",
    );
    expect(stepsSection?.status).toBe("missing");
  });

  it("returns invalid when a required section is present but empty", () => {
    const issueBody = `## Description


## Steps to Reproduce
1. Do something

## Expected Behavior
Works correctly.
`;
    const result = diffAgainstTemplate(template, issueBody);
    expect(result.valid).toBe(false);

    const descSection = result.sections.find((s) => s.heading === "Description");
    expect(descSection?.status).toBe("empty");
  });

  it("detects placeholder text as empty", () => {
    const issueBody = `## Description
N/A

## Steps to Reproduce
1. Real steps here

## Expected Behavior
Should work properly.
`;
    const result = diffAgainstTemplate(template, issueBody);
    expect(result.valid).toBe(false);

    const descSection = result.sections.find((s) => s.heading === "Description");
    expect(descSection?.status).toBe("empty");
  });

  it("stays valid when optional section is missing", () => {
    const issueBody = `## Description
Real description with details.

## Steps to Reproduce
1. Step one
2. Step two

## Expected Behavior
It should work.
`;
    // No ## Screenshots section -- but it's optional
    const result = diffAgainstTemplate(template, issueBody);
    expect(result.valid).toBe(true);

    const screenshotsSection = result.sections.find(
      (s) => s.heading === "Screenshots",
    );
    expect(screenshotsSection?.status).toBe("missing");
    expect(screenshotsSection?.required).toBe(false);
  });

  it("ignores extra sections not in template", () => {
    const issueBody = `## Description
Bug description here.

## Steps to Reproduce
1. Do X

## Expected Behavior
Should do Y.

## Additional Context
Some extra info.
`;
    const result = diffAgainstTemplate(template, issueBody);
    expect(result.valid).toBe(true);
    // "Additional Context" is not in template -- should be ignored
    expect(result.sections).toHaveLength(4); // only template sections
  });

  it("detects content matching hint text as empty", () => {
    const issueBody = `## Description
A clear description of the bug

## Steps to Reproduce
1. Step one
2. Step two

## Expected Behavior
It should work.
`;
    const result = diffAgainstTemplate(template, issueBody);
    // "A clear description of the bug" matches the hint exactly
    const descSection = result.sections.find((s) => s.heading === "Description");
    expect(descSection?.status).toBe("empty");
    expect(result.valid).toBe(false);
  });

  it("handles empty issue body -- all sections missing", () => {
    const result = diffAgainstTemplate(template, "");
    expect(result.valid).toBe(false);
    expect(result.sections.filter((s) => s.status === "missing")).toHaveLength(4);
  });

  it("matches headings case-insensitively", () => {
    const issueBody = `## description
Real description here.

## steps to reproduce
1. Step one

## expected behavior
Should work.
`;
    const result = diffAgainstTemplate(template, issueBody);
    expect(result.valid).toBe(true);
  });

  it("detects whitespace-only content as empty", () => {
    const issueBody = `## Description



## Steps to Reproduce
1. Step

## Expected Behavior
Works.
`;
    const result = diffAgainstTemplate(template, issueBody);
    const descSection = result.sections.find((s) => s.heading === "Description");
    expect(descSection?.status).toBe("empty");
  });

  it("strips HTML comments before checking emptiness", () => {
    const issueBody = `## Description
<!-- A clear description of the bug -->

## Steps to Reproduce
1. Real steps

## Expected Behavior
Should work.
`;
    const result = diffAgainstTemplate(template, issueBody);
    const descSection = result.sections.find((s) => s.heading === "Description");
    expect(descSection?.status).toBe("empty");
  });
});
