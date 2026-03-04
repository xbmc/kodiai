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

/** Result of a voice-preserving generation with validation. */
export type VoicePreservedSuggestion = {
  /** The generated or regenerated suggestion text. */
  suggestion: string;
  /** True if both initial and retry validation failed. */
  voiceMismatchWarning: boolean;
  /** The final validation result (from last validation attempt). */
  validationResult: VoiceValidationResult;
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
  const suggestion = await opts.generateFn();

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

  if (validation.passed) {
    return {
      suggestion,
      voiceMismatchWarning: false,
      validationResult: validation,
    };
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
    return {
      suggestion: regeneratedSuggestion,
      voiceMismatchWarning: false,
      validationResult: validation,
    };
  }

  // Step 5: Both failed — publish with warning tag
  logger.warn(
    {
      pageTitle: opts.styleDescription.pageTitle,
      overallScore: validation.overallScore,
    },
    "Voice mismatch: retry also failed, tagging suggestion with warning",
  );

  return {
    suggestion: regeneratedSuggestion,
    voiceMismatchWarning: true,
    validationResult: validation,
  };
}
