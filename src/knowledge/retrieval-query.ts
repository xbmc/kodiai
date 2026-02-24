export type RetrievalQuerySignals = {
  prTitle: string;
  prBody?: string;
  conventionalType?: string | null;
  detectedLanguages: string[];
  riskSignals: string[];
  authorTier?: string;
  topFilePaths: string[];
};

const MAX_BODY_LENGTH = 200;
const MAX_LANGUAGES = 5;
const MAX_RISK_SIGNALS = 3;
const MAX_FILE_PATHS = 15;
const MAX_TOTAL_LENGTH = 800;

export function buildRetrievalQuery(signals: RetrievalQuerySignals): string {
  const parts: string[] = [];

  // 1. PR title (always, highest priority)
  parts.push(signals.prTitle);

  // 2. Body excerpt (first 200 chars, if present and non-empty)
  if (signals.prBody && signals.prBody.length > 0) {
    const excerpt = signals.prBody.slice(0, MAX_BODY_LENGTH);
    parts.push(excerpt);
  }

  // 3. Conventional type tag in brackets (if present)
  if (signals.conventionalType) {
    parts.push(`[${signals.conventionalType}]`);
  }

  // 4. Languages line (first 5, if any)
  if (signals.detectedLanguages.length > 0) {
    const langs = signals.detectedLanguages.slice(0, MAX_LANGUAGES);
    parts.push(`Languages: ${langs.join(", ")}`);
  }

  // 5. Risk line (first 3, if any)
  if (signals.riskSignals.length > 0) {
    const risks = signals.riskSignals.slice(0, MAX_RISK_SIGNALS);
    parts.push(`Risk: ${risks.join(", ")}`);
  }

  // 6. Author tier (if present)
  if (signals.authorTier) {
    parts.push(`Author: ${signals.authorTier}`);
  }

  // 7. File paths (first 15, newline-separated)
  if (signals.topFilePaths.length > 0) {
    const paths = signals.topFilePaths.slice(0, MAX_FILE_PATHS);
    parts.push(paths.join("\n"));
  }

  // Join all parts with newline
  const joined = parts.join("\n");

  // Cap total length at 800 chars to prevent embedding quality degradation
  if (joined.length > MAX_TOTAL_LENGTH) {
    return joined.slice(0, MAX_TOTAL_LENGTH);
  }

  return joined;
}
