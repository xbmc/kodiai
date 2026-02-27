/**
 * Type definitions for issue template parsing and triage validation.
 */

/** A single section extracted from a GitHub issue template. */
export type TemplateSection = {
  /** Section heading text (e.g., "Description") */
  heading: string;
  /** True unless marked with <!-- optional --> comment */
  required: boolean;
  /** Hint text extracted from HTML comments below the heading */
  hint: string | null;
};

/** Parsed representation of a .md issue template. */
export type TemplateDefinition = {
  /** Filename without extension (e.g., "bug-report") */
  slug: string;
  /** From YAML frontmatter `name` field, or slug if no frontmatter */
  name: string;
  /** From YAML frontmatter `labels` field */
  labels: string[];
  /** Extracted sections from template body */
  sections: TemplateSection[];
};

/** Status of a section in the issue body relative to the template. */
export type SectionStatus = "present" | "missing" | "empty";

/** Validation result for a single section. */
export type SectionResult = {
  heading: string;
  status: SectionStatus;
  /** Hint from template, used in guidance comments */
  hint: string | null;
  required: boolean;
};

/** Overall result of validating an issue body against a template. */
export type TriageValidationResult = {
  templateSlug: string;
  templateName: string;
  sections: SectionResult[];
  /** True if all required sections are present and non-empty */
  valid: boolean;
};
