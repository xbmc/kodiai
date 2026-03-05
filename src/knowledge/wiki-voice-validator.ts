/**
 * Wiki voice validator: compares generated suggestions against original sections
 * using LLM-based 6-dimension scoring, with automatic retry-with-feedback on failure.
 *
 * Flow: suggestion + original -> LLM validation -> pass/fail -> retry if needed -> result
 */

import type { Logger } from "pino";
import type {
  PageStyleDescription,
  VoiceAnalyzerOptions,
  VoiceValidationResult,
  VoiceMatchScores,
} from "./wiki-voice-types.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { TASK_TYPES } from "../llm/task-types.ts";

/** Default threshold: average score must be >= 3.5 to pass voice validation. */
export const VOICE_MATCH_THRESHOLD = 3.5;

// ── Post-generation validation checks ──────────────────────────────

/**
 * Check that all {{TemplateName}} patterns from original appear in suggestion.
 * Compares template names only (ignores parameter differences).
 */
export function checkTemplatePreservation(
  originalText: string,
  suggestionText: string,
): { passed: boolean; missingTemplates: string[] } {
  // Extract template names: {{Name with any chars until | or }}
  const templateNameRegex = /\{\{([^|}]+)/g;
  const originalNames = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = templateNameRegex.exec(originalText)) !== null) {
    originalNames.add(match[1]!.trim());
  }

  if (originalNames.size === 0) {
    return { passed: true, missingTemplates: [] };
  }

  const suggestionNames = new Set<string>();
  const suggestionRegex = /\{\{([^|}]+)/g;
  while ((match = suggestionRegex.exec(suggestionText)) !== null) {
    suggestionNames.add(match[1]!.trim());
  }

  const missing: string[] = [];
  for (const name of originalNames) {
    if (!suggestionNames.has(name)) {
      missing.push(`{{${name}}}`);
    }
  }

  return { passed: missing.length === 0, missingTemplates: missing };
}

/**
 * Check that heading levels in suggestion match original.
 * Supports both MediaWiki (== Heading ==) and Markdown (## Heading) styles.
 */
export function checkHeadingLevels(
  originalText: string,
  suggestionText: string,
): { passed: boolean; mismatches: string[] } {
  const extractHeadingLevels = (text: string): Set<string> => {
    const levels = new Set<string>();
    // MediaWiki: == Heading ==
    for (const m of text.matchAll(/^(={2,6})\s*[^=]+=+\s*$/gm)) {
      levels.add(`mw-${m[1]!.length}`);
    }
    // Markdown: ## Heading
    for (const m of text.matchAll(/^(#{1,6})\s+/gm)) {
      levels.add(`md-${m[1]!.length}`);
    }
    return levels;
  };

  const originalLevels = extractHeadingLevels(originalText);
  const suggestionLevels = extractHeadingLevels(suggestionText);

  if (originalLevels.size === 0) {
    return { passed: true, mismatches: [] };
  }

  const mismatches: string[] = [];
  for (const level of originalLevels) {
    if (!suggestionLevels.has(level)) {
      mismatches.push(`Original has ${level} heading but suggestion does not`);
    }
  }
  // Check if suggestion introduced new heading styles not in original
  for (const level of suggestionLevels) {
    if (!originalLevels.has(level)) {
      mismatches.push(`Suggestion introduces ${level} heading not in original`);
    }
  }

  return { passed: mismatches.length === 0, mismatches };
}

/**
 * Detect novel formatting elements in suggestion that aren't in original.
 * Advisory only — these are encouraged per CONTEXT.md, just flagged for visibility.
 */
export function checkFormattingNovelty(
  originalText: string,
  suggestionText: string,
): { novelElements: string[] } {
  const novel: string[] = [];

  const hasCodeBlock = (t: string) => /```|<code|<pre/m.test(t);
  const hasTable = (t: string) => /^\|.+\|/m.test(t) || /<table/i.test(t);
  const hasBold = (t: string) => /\*\*[^*]+\*\*|'''[^']+'''/.test(t);

  if (!hasCodeBlock(originalText) && hasCodeBlock(suggestionText)) {
    novel.push("Code blocks added");
  }
  if (!hasTable(originalText) && hasTable(suggestionText)) {
    novel.push("Tables added");
  }
  if (!hasBold(originalText) && hasBold(suggestionText)) {
    novel.push("Bold emphasis added");
  }

  return { novelElements: novel };
}

/**
 * Advisory check: flag when suggestion exceeds 150% of original length.
 */
export function checkSectionLength(
  originalText: string,
  suggestionText: string,
): { advisory: string | null } {
  if (originalText.length === 0) return { advisory: null };
  const ratio = suggestionText.length / originalText.length;
  if (ratio > 1.5) {
    return { advisory: "Consider splitting this section — suggestion is significantly longer than original" };
  }
  return { advisory: null };
}

/** Result of a voice-preserving generation with validation. */
export type VoicePreservedSuggestion = {
  /** The generated or regenerated suggestion text. */
  suggestion: string;
  /** True if both initial and retry validation failed. */
  voiceMismatchWarning: boolean;
  /** The final validation result (from last validation attempt). */
  validationResult: VoiceValidationResult;
  /** Whether all original {{...}} templates were preserved. */
  templateCheckPassed: boolean;
  /** Whether heading levels match original. */
  headingCheckPassed: boolean;
  /** Advisory list of novel formatting elements (not blocking). */
  formattingAdvisory: string[];
  /** Advisory note if section grew significantly. */
  sectionLengthAdvisory: string | null;
};

/**
 * Parse LLM voice validation response into structured result.
 *
 * Expected format:
 * ```
 * TONE_MATCH: N
 * PERSPECTIVE_MATCH: N
 * STRUCTURE_MATCH: N
 * TERMINOLOGY_MATCH: N
 * FORMATTING_MATCH: N
 * MARKUP_PRESERVATION: N
 * OVERALL: PASS|FAIL
 * FEEDBACK: [specific issues if FAIL]
 * ```
 *
 * Exported for testing.
 */
export function parseVoiceValidation(text: string): VoiceValidationResult {
  const parseScore = (label: string): number => {
    const match = text.match(new RegExp(`${label}:\\s*(\\d+(?:\\.\\d+)?)`));
    return match ? parseFloat(match[1]!) : 0;
  };

  const scores: VoiceMatchScores = {
    toneMatch: parseScore("TONE_MATCH"),
    perspectiveMatch: parseScore("PERSPECTIVE_MATCH"),
    structureMatch: parseScore("STRUCTURE_MATCH"),
    terminologyMatch: parseScore("TERMINOLOGY_MATCH"),
    formattingMatch: parseScore("FORMATTING_MATCH"),
    markupPreservation: parseScore("MARKUP_PRESERVATION"),
  };

  const scoreValues = Object.values(scores);
  const hasAnyScores = scoreValues.some((s) => s > 0);

  if (!hasAnyScores) {
    return {
      passed: false,
      scores,
      overallScore: 0,
      feedback: "Voice validation response could not be parsed",
    };
  }

  const overallScore =
    scoreValues.reduce((sum, s) => sum + s, 0) / scoreValues.length;
  const passed = overallScore >= VOICE_MATCH_THRESHOLD;

  // Extract feedback after "FEEDBACK:" line
  let feedback: string | null = null;
  const feedbackMatch = text.match(/FEEDBACK:\s*([\s\S]*?)$/m);
  if (feedbackMatch && feedbackMatch[1]?.trim()) {
    feedback = feedbackMatch[1].trim();
  }

  return {
    passed,
    scores,
    overallScore,
    feedback: passed ? null : feedback,
  };
}

/**
 * Build the voice validation prompt.
 */
function buildVoiceValidationPrompt(opts: {
  originalSection: string;
  generatedSuggestion: string;
  styleDescription: PageStyleDescription;
}): string {
  return `Compare this generated wiki section update against the original section and style description.

ORIGINAL SECTION:
${opts.originalSection}

STYLE DESCRIPTION:
${opts.styleDescription.styleText}

GENERATED SUGGESTION:
${opts.generatedSuggestion}

Score the voice match on these dimensions (1-5 each):
- TONE_MATCH: Does the tone match? (formal/informal, technical level)
- PERSPECTIVE_MATCH: Same perspective? (you/imperative/third person)
- STRUCTURE_MATCH: Similar sentence patterns and paragraph structure?
- TERMINOLOGY_MATCH: Uses same terms consistently?
- FORMATTING_MATCH: Same heading/list/code/link conventions?
- MARKUP_PRESERVATION: All MediaWiki templates/markup preserved exactly?

Overall voice match: PASS (avg >= ${VOICE_MATCH_THRESHOLD}) or FAIL (avg < ${VOICE_MATCH_THRESHOLD})

If FAIL, explain specifically what doesn't match and how to fix it.

Output format:
TONE_MATCH: N
PERSPECTIVE_MATCH: N
STRUCTURE_MATCH: N
TERMINOLOGY_MATCH: N
FORMATTING_MATCH: N
MARKUP_PRESERVATION: N
OVERALL: PASS|FAIL
FEEDBACK: [specific issues if FAIL]`;
}

/**
 * Validate a generated suggestion against the original section's voice.
 *
 * Uses LLM to compare on 6 dimensions (1-5 scale each).
 * Returns pass/fail based on VOICE_MATCH_THRESHOLD average.
 */
export async function validateVoiceMatch(
  opts: {
    originalSection: string;
    generatedSuggestion: string;
    styleDescription: PageStyleDescription;
  } & VoiceAnalyzerOptions,
): Promise<VoiceValidationResult> {
  const logger = opts.logger.child({ module: "wiki-voice-validator" });

  const prompt = buildVoiceValidationPrompt({
    originalSection: opts.originalSection,
    generatedSuggestion: opts.generatedSuggestion,
    styleDescription: opts.styleDescription,
  });

  const resolved = opts.taskRouter.resolve(TASK_TYPES.VOICE_VALIDATE);

  const result = await generateWithFallback({
    taskType: TASK_TYPES.VOICE_VALIDATE,
    resolved,
    prompt,
    logger,
    costTracker: opts.costTracker,
    repo: opts.repo,
  });

  const validation = parseVoiceValidation(result.text);

  logger.debug(
    {
      pageTitle: opts.styleDescription.pageTitle,
      overallScore: validation.overallScore,
      passed: validation.passed,
      dimensions: validation.scores,
    },
    "Voice validation complete",
  );

  return validation;
}

/**
 * Generate a suggestion with voice preservation and automatic retry.
 *
 * Flow:
 * 1. Generate suggestion via generateFn
 * 2. Validate voice match
 * 3. If failed: regenerate with feedback injected, re-validate
 * 4. If still failed: return with voiceMismatchWarning=true
 */
export async function generateWithVoicePreservation(
  opts: {
    /** Function that generates the initial suggestion. */
    generateFn: () => Promise<string>;
    /** Original section content for comparison. */
    originalSection: string;
    /** Style description for the page. */
    styleDescription: PageStyleDescription;
    /** Function that regenerates with feedback injected into prompt. */
    buildPromptWithFeedback: (feedback: string) => Promise<string>;
  } & VoiceAnalyzerOptions,
): Promise<VoicePreservedSuggestion> {
  const logger = opts.logger.child({ module: "wiki-voice-validator" });

  // Step 1: Generate initial suggestion
  let suggestion = await opts.generateFn();

  // Step 1b: Post-generation template check (retry once, drop on second failure)
  let templateCheck = checkTemplatePreservation(opts.originalSection, suggestion);
  if (!templateCheck.passed) {
    logger.warn(
      { missing: templateCheck.missingTemplates },
      "Template check failed, regenerating with feedback about missing templates",
    );
    suggestion = await opts.buildPromptWithFeedback(
      `Missing templates that MUST be preserved: ${templateCheck.missingTemplates.join(", ")}. Include ALL original templates in your output.`,
    );
    templateCheck = checkTemplatePreservation(opts.originalSection, suggestion);
    if (!templateCheck.passed) {
      logger.warn(
        { missing: templateCheck.missingTemplates },
        "Template check failed on retry, dropping suggestion",
      );
      return {
        suggestion: "",
        voiceMismatchWarning: false,
        validationResult: { passed: false, scores: { toneMatch: 0, perspectiveMatch: 0, structureMatch: 0, terminologyMatch: 0, formattingMatch: 0, markupPreservation: 0 }, overallScore: 0, feedback: "Template preservation failed after retry" },
        templateCheckPassed: false,
        headingCheckPassed: false,
        formattingAdvisory: [],
        sectionLengthAdvisory: null,
      };
    }
  }

  // Step 1c: Post-generation heading, formatting, length checks
  const headingCheck = checkHeadingLevels(opts.originalSection, suggestion);
  const formattingCheck = checkFormattingNovelty(opts.originalSection, suggestion);
  const lengthCheck = checkSectionLength(opts.originalSection, suggestion);

  if (formattingCheck.novelElements.length > 0) {
    logger.debug({ novelElements: formattingCheck.novelElements }, "Novel formatting detected (advisory)");
  }

  // Step 2: Validate voice match
  let validation = await validateVoiceMatch({
    originalSection: opts.originalSection,
    generatedSuggestion: suggestion,
    styleDescription: opts.styleDescription,
    taskRouter: opts.taskRouter,
    costTracker: opts.costTracker,
    logger: opts.logger,
    repo: opts.repo,
  });

  const makeResult = (s: string, mismatch: boolean, v: VoiceValidationResult): VoicePreservedSuggestion => ({
    suggestion: s,
    voiceMismatchWarning: mismatch,
    validationResult: v,
    templateCheckPassed: templateCheck.passed,
    headingCheckPassed: headingCheck.passed,
    formattingAdvisory: formattingCheck.novelElements,
    sectionLengthAdvisory: lengthCheck.advisory,
  });

  if (validation.passed) {
    return makeResult(suggestion, false, validation);
  }

  // Step 3: Retry with feedback
  logger.warn(
    {
      pageTitle: opts.styleDescription.pageTitle,
      overallScore: validation.overallScore,
      feedback: validation.feedback,
    },
    "Voice validation failed, retrying with feedback",
  );

  const regeneratedSuggestion = await opts.buildPromptWithFeedback(
    validation.feedback ?? "Voice style does not match the original section",
  );

  // Step 4: Re-validate
  validation = await validateVoiceMatch({
    originalSection: opts.originalSection,
    generatedSuggestion: regeneratedSuggestion,
    styleDescription: opts.styleDescription,
    taskRouter: opts.taskRouter,
    costTracker: opts.costTracker,
    logger: opts.logger,
    repo: opts.repo,
  });

  if (validation.passed) {
    return makeResult(regeneratedSuggestion, false, validation);
  }

  // Step 5: Both failed — publish with warning tag
  logger.warn(
    {
      pageTitle: opts.styleDescription.pageTitle,
      overallScore: validation.overallScore,
    },
    "Voice mismatch: retry also failed, tagging suggestion with warning",
  );

  return makeResult(regeneratedSuggestion, true, validation);
}
