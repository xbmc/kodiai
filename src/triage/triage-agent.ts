/**
 * Triage validation agent: validates issue bodies against repo templates,
 * generates guidance comments and label recommendations.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseTemplate, diffAgainstTemplate } from "./template-parser.ts";
import type { TemplateDefinition, TriageValidationResult } from "./types.ts";

const TEMPLATE_DIR = ".github/ISSUE_TEMPLATE";

/**
 * Validate an issue body against the repo's templates.
 *
 * @returns Validation result for the best-fit template, or null if no template matched
 */
export async function validateIssue(params: {
  workspaceDir: string;
  issueBody: string | null;
}): Promise<TriageValidationResult | null> {
  const { workspaceDir, issueBody } = params;

  if (!issueBody || issueBody.trim().length === 0) {
    return null;
  }

  // Read templates from workspace
  const templateDir = path.join(workspaceDir, TEMPLATE_DIR);
  let files: string[];
  try {
    const entries = await readdir(templateDir);
    files = entries.filter((f) => f.endsWith(".md"));
  } catch {
    // Directory doesn't exist or not readable
    return null;
  }

  if (files.length === 0) {
    return null;
  }

  // Parse all templates
  const templates: TemplateDefinition[] = [];
  for (const file of files) {
    try {
      const content = await readFile(path.join(templateDir, file), "utf-8");
      const slug = file.replace(/\.md$/, "");
      templates.push(parseTemplate(slug, content));
    } catch {
      // Skip unreadable files
      continue;
    }
  }

  if (templates.length === 0) {
    return null;
  }

  // Best-fit matching: count heading matches per template
  const issueHeadings = extractHeadings(issueBody);
  const bestTemplate = findBestFitTemplate(templates, issueHeadings);

  if (!bestTemplate) {
    return null;
  }

  return diffAgainstTemplate(bestTemplate, issueBody);
}

/**
 * Extract ## headings from text (case-insensitive comparison).
 */
function extractHeadings(text: string): string[] {
  const headings: string[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^##\s+(.+)/);
    if (match) {
      headings.push(match[1].trim().toLowerCase());
    }
  }
  return headings;
}

/**
 * Find the template with the most heading matches.
 * Requires at least 1 match.
 */
function findBestFitTemplate(
  templates: TemplateDefinition[],
  issueHeadings: string[],
): TemplateDefinition | null {
  let best: TemplateDefinition | null = null;
  let bestScore = 0;

  for (const template of templates) {
    let score = 0;
    for (const section of template.sections) {
      if (
        issueHeadings.includes(section.heading.toLowerCase())
      ) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  }

  return bestScore >= 1 ? best : null;
}

/**
 * Generate a friendly guidance comment for missing/empty sections.
 *
 * @returns Comment text, or empty string if no required sections are missing
 */
export function generateGuidanceComment(
  result: TriageValidationResult,
): string {
  const missingRequired = result.sections.filter(
    (s) => s.required && s.status !== "present",
  );

  if (missingRequired.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push(
    "Thanks for filing! A few details would help us help you faster:",
  );
  lines.push("");

  for (const section of missingRequired) {
    const statusNote =
      section.status === "missing"
        ? "This section is missing"
        : "This section looks empty";

    if (section.hint) {
      lines.push(`- **${section.heading}**: ${statusNote} -- ${section.hint}`);
    } else {
      lines.push(`- **${section.heading}**: ${statusNote}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a convention-based label recommendation.
 *
 * @returns Label string (e.g., "needs-info:bug-report"), or null if not needed
 */
export function generateLabelRecommendation(params: {
  result: TriageValidationResult;
  labelAllowlist: string[];
}): string | null {
  const { result, labelAllowlist } = params;

  // No label needed if issue passes validation
  if (result.valid) {
    return null;
  }

  const derivedLabel = `needs-info:${result.templateSlug}`;

  // Check allowlist if non-empty
  if (labelAllowlist.length > 0) {
    const allowed = labelAllowlist.some(
      (pattern) =>
        derivedLabel === pattern ||
        derivedLabel.startsWith(pattern),
    );
    if (!allowed) {
      return null;
    }
  }

  return derivedLabel;
}

/**
 * Generate a generic nudge for issues that don't match any template.
 */
export function generateGenericNudge(): string {
  return (
    "It looks like this issue wasn't filed using one of our templates. " +
    "Using a template helps us understand and prioritize your request faster " +
    "-- check out the available templates when creating a new issue."
  );
}
