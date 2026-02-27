/**
 * Parse GitHub .md issue templates and diff against issue bodies.
 *
 * Handles both YAML-frontmatter and plain-header templates.
 * No external YAML dependency -- frontmatter fields are simple key-value.
 */

import type { TemplateDefinition, TemplateSection, TriageValidationResult, SectionResult } from "./types.ts";

/**
 * Parse a .md issue template into a structured definition.
 *
 * @param slug - Filename without extension (e.g., "bug-report")
 * @param content - Raw template file content
 */
export function parseTemplate(slug: string, content: string): TemplateDefinition {
  let body = content;
  let name = slug;
  let labels: string[] = [];

  // Parse YAML frontmatter if present
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    body = content.slice(frontmatterMatch[0].length);

    // Extract name
    const nameMatch = frontmatter.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }

    // Extract labels (comma-separated string or YAML list)
    const labelsLineMatch = frontmatter.match(/^labels:\s*(.+)$/m);
    if (labelsLineMatch) {
      const labelsValue = labelsLineMatch[1].trim();
      // Handle both: "bug, enhancement" and "[bug, enhancement]"
      const cleaned = labelsValue.replace(/^\[|\]$/g, "");
      labels = cleaned
        .split(",")
        .map((l) => l.trim().replace(/^['"]|['"]$/g, ""))
        .filter((l) => l.length > 0);
    } else {
      // Handle YAML list format (multi-line)
      const labelsBlockMatch = frontmatter.match(/^labels:\s*\n((?:\s+-\s+.+\n?)+)/m);
      if (labelsBlockMatch) {
        labels = labelsBlockMatch[1]
          .split("\n")
          .map((line) => line.replace(/^\s*-\s*/, "").trim().replace(/^['"]|['"]$/g, ""))
          .filter((l) => l.length > 0);
      }
    }
  }

  // Extract sections from body
  const sections = extractSections(body);

  return { slug, name, labels, sections };
}

/**
 * Extract ## heading sections from template body.
 */
function extractSections(body: string): TemplateSection[] {
  const sections: TemplateSection[] = [];
  const lines = body.split("\n");

  let i = 0;
  while (i < lines.length) {
    const headingMatch = lines[i].match(/^##\s+(.+)/);
    if (!headingMatch) {
      i++;
      continue;
    }

    const heading = headingMatch[1].trim();
    i++;

    // Collect content between this heading and the next ## heading
    const contentLines: string[] = [];
    while (i < lines.length && !lines[i].match(/^##\s+/)) {
      contentLines.push(lines[i]);
      i++;
    }

    const sectionContent = contentLines.join("\n");

    // Check for optional marker (case-insensitive)
    const isOptional = /<!--\s*optional\s*-->/i.test(sectionContent);

    // Extract hint from HTML comments (excluding the optional marker)
    let hint: string | null = null;
    const commentMatches = sectionContent.matchAll(/<!--\s*([\s\S]*?)\s*-->/g);
    for (const match of commentMatches) {
      const commentText = match[1].trim();
      if (!/^optional$/i.test(commentText) && commentText.length > 0) {
        hint = commentText;
        break; // Use first non-optional comment as hint
      }
    }

    sections.push({
      heading,
      required: !isOptional,
      hint,
    });
  }

  return sections;
}

/**
 * Diff an issue body against a template to identify missing/empty sections.
 *
 * @param template - Parsed template definition
 * @param issueBody - Raw issue body text
 */
export function diffAgainstTemplate(
  template: TemplateDefinition,
  issueBody: string,
): TriageValidationResult {
  // Parse headings from issue body
  const issueHeadings = extractIssueHeadings(issueBody);

  const sections: SectionResult[] = template.sections.map((section) => {
    const match = findMatchingHeading(section.heading, issueHeadings);

    if (!match) {
      return {
        heading: section.heading,
        status: "missing" as const,
        hint: section.hint,
        required: section.required,
      };
    }

    // Check if content is empty or placeholder
    if (isEmptyOrPlaceholder(match.content, section.hint)) {
      return {
        heading: section.heading,
        status: "empty" as const,
        hint: section.hint,
        required: section.required,
      };
    }

    return {
      heading: section.heading,
      status: "present" as const,
      hint: section.hint,
      required: section.required,
    };
  });

  const valid = sections
    .filter((s) => s.required)
    .every((s) => s.status === "present");

  return {
    templateSlug: template.slug,
    templateName: template.name,
    sections,
    valid,
  };
}

type IssueHeading = {
  heading: string;
  content: string;
};

/**
 * Extract ## headings and their content from an issue body.
 */
function extractIssueHeadings(body: string): IssueHeading[] {
  const headings: IssueHeading[] = [];
  const lines = body.split("\n");

  let i = 0;
  while (i < lines.length) {
    const headingMatch = lines[i].match(/^##\s+(.+)/);
    if (!headingMatch) {
      i++;
      continue;
    }

    const heading = headingMatch[1].trim();
    i++;

    const contentLines: string[] = [];
    while (i < lines.length && !lines[i].match(/^##\s+/)) {
      contentLines.push(lines[i]);
      i++;
    }

    headings.push({
      heading,
      content: contentLines.join("\n"),
    });
  }

  return headings;
}

/**
 * Find a matching heading in the issue body (case-insensitive).
 */
function findMatchingHeading(
  templateHeading: string,
  issueHeadings: IssueHeading[],
): IssueHeading | undefined {
  const normalized = templateHeading.toLowerCase().trim();
  return issueHeadings.find(
    (h) => h.heading.toLowerCase().trim() === normalized,
  );
}

/** Common placeholder patterns that indicate empty/unfilled content. */
const PLACEHOLDER_PATTERNS = [
  /^\s*$/,
  /^\s*n\/?a\s*$/i,
  /^\s*none\s*$/i,
  /^\s*-\s*$/,
  /^\s*\.\.\.\s*$/,
  /^\s*todo\s*$/i,
  /^\s*tbd\s*$/i,
];

/**
 * Check if section content is empty or contains only placeholder text.
 */
function isEmptyOrPlaceholder(
  content: string,
  hint: string | null,
): boolean {
  // Strip HTML comments from content before checking
  const stripped = content.replace(/<!--[\s\S]*?-->/g, "").trim();

  if (stripped.length === 0) {
    return true;
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(stripped)) {
      return true;
    }
  }

  // Check if content exactly matches the hint (user didn't replace placeholder)
  if (hint && stripped.toLowerCase() === hint.toLowerCase()) {
    return true;
  }

  return false;
}
