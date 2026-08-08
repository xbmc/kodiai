/**
 * Format bounded-first-pass review findings as structured sections
 * (Blocking/Design/Minor/Testing) instead of raw prose, per PR #206.
 */

export type BoundedFindingsBySection = {
  blocking: BoundedFinding[];
  design: BoundedFinding[];
  minor: BoundedFinding[];
  testing: BoundedFinding[];
};

export type BoundedFinding = {
  title: string;
  description: string;
  location?: string; // file:line
  suggestedFix?: string;
};

/**
 * Parse findings from bounded-first-pass prose and structure them
 * by severity/category. Extracts [CRITICAL]/[MAJOR]/etc tags.
 */
export function parseAndStructureBoundedFindings(prose: string): BoundedFindingsBySection {
  const blocking: BoundedFinding[] = [];
  const design: BoundedFinding[] = [];
  const minor: BoundedFinding[] = [];
  const testing: BoundedFinding[] = [];

  // Extract severity patterns: [CRITICAL], [MAJOR], [MEDIUM], [MINOR]
  // and categorize as Blocking (CRITICAL/MAJOR), Design (structural), Minor (MINOR), Testing
  const lines = prose.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match patterns like: [MAJOR] description - location
    const match = line.match(/^\[?(CRITICAL|MAJOR|MEDIUM|MINOR|Medium|Major|Critical|Minor)\]?\s+(.+?)(\s+-\s+(.+))?$/);
    if (!match) continue;

    const severity = match[1].toUpperCase();
    const description = match[2].trim();
    const location = match[4]?.trim();

    const finding: BoundedFinding = {
      title: extractTitleFromDescription(description),
      description,
      ...(location ? { location } : {}),
    };

    if (severity === "CRITICAL" || severity === "MAJOR") {
      blocking.push(finding);
    } else if (severity === "MEDIUM") {
      // MEDIUM could be design or structural; assess content
      if (isDesignLevel(description)) {
        design.push(finding);
      } else {
        minor.push(finding);
      }
    } else {
      minor.push(finding);
    }
  }

  return { blocking, design, minor, testing };
}

function extractTitleFromDescription(desc: string): string {
  // Extract first sentence or clause as title
  const firstSentence = desc.split(/[.!?]/)[0].trim();
  return firstSentence.length > 0 ? firstSentence : desc.slice(0, 80);
}

function isDesignLevel(description: string): boolean {
  const designKeywords = [
    "design", "architecture", "pattern", "refactor", "simplify",
    "deprecat", "removal", "scope", "boundary", "invariant", "contract",
  ];
  const lower = description.toLowerCase();
  return designKeywords.some((kw) => lower.includes(kw));
}

/**
 * Format structured findings as PR comment sections (Blocking/Design/Minor/Testing).
 */
export function formatBoundedFindingsAsStructuredComment(
  findings: BoundedFindingsBySection,
): string {
  const sections: string[] = [];

  if (findings.blocking.length > 0) {
    sections.push(`## Blocking (${findings.blocking.length} ${findings.blocking.length === 1 ? "finding" : "findings"})\n`);
    for (const finding of findings.blocking) {
      sections.push(formatFinding(finding));
    }
    sections.push("");
  }

  if (findings.design.length > 0) {
    sections.push(`## Design Concern (${findings.design.length} ${findings.design.length === 1 ? "finding" : "findings"})\n`);
    for (const finding of findings.design) {
      sections.push(formatFinding(finding));
    }
    sections.push("");
  }

  if (findings.minor.length > 0) {
    sections.push(`## Minor / Style (${findings.minor.length} ${findings.minor.length === 1 ? "finding" : "findings"})\n`);
    for (const finding of findings.minor) {
      sections.push(formatFinding(finding));
    }
    sections.push("");
  }

  if (findings.testing.length > 0) {
    sections.push(`## Testing (${findings.testing.length} ${findings.testing.length === 1 ? "finding" : "findings"})\n`);
    for (const finding of findings.testing) {
      sections.push(formatFinding(finding));
    }
    sections.push("");
  }

  return sections.join("\n").trim();
}

function formatFinding(finding: BoundedFinding): string {
  const lines: string[] = [];
  lines.push(`- **${finding.title}**`);
  if (finding.description && finding.description !== finding.title) {
    lines.push(`  ${finding.description}`);
  }
  if (finding.location) {
    lines.push(`  \`${finding.location}\``);
  }
  if (finding.suggestedFix) {
    lines.push(`  **Fix:** ${finding.suggestedFix}`);
  }
  return lines.join("\n");
}
