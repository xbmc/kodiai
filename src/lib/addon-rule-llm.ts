import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
import type { AddonRuleEvidenceContext } from "./addon-rule-evidence.ts";
import { projectAddonRuleEvidence } from "./addon-rule-evidence.ts";
import type { AddonRuleSource } from "./addon-rule-source.ts";
import type { AddonRuleFinding } from "./addon-rule-types.ts";

export type AddonRuleLlmInput = {
  repo: string;
  prNumber: number;
  baseBranch: string;
  rules: AddonRuleSource;
  contexts: readonly AddonRuleAddonContext[];
};

export type AddonRuleLlmResult = {
  summary?: string;
  findings: AddonRuleFinding[];
  rejectedSummary?: true;
  rejectedOutput?: true;
};

const MAX_SUMMARY_CHARS = 600;
const MAX_FINDINGS = 20;
const MAX_MESSAGE_CHARS = 400;
const MAX_RULE_CHARS = 80;
const TRIMMED_NON_WHITESPACE_PATTERN = "^(?!\\s)[\\s\\S]*\\S(?![\\s\\S])$";
const trimmedNonWhitespace = new RegExp(TRIMMED_NON_WHITESPACE_PATTERN);

export const ADDON_RULE_MODEL_RULE_IDS = [
  "filesystem-boundaries",
  "download-consent",
  "executable-execution",
  "addon-modification",
  "direct-database-access",
  "skin-view-sort-mode",
  "usage-analytics",
  "obfuscation",
] as const;

const addonRuleModelRuleIds = new Set<string>(ADDON_RULE_MODEL_RULE_IDS);

export const ADDON_RULE_REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      maxLength: MAX_SUMMARY_CHARS,
      pattern: TRIMMED_NON_WHITESPACE_PATTERN,
    },
    findings: {
      type: "array",
      maxItems: MAX_FINDINGS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["addonId", "path", "line", "rule", "level", "message"],
        properties: {
          addonId: { type: "string", minLength: 1, pattern: TRIMMED_NON_WHITESPACE_PATTERN },
          path: { type: "string", minLength: 1, pattern: TRIMMED_NON_WHITESPACE_PATTERN },
          line: { type: "integer", minimum: 1 },
          rule: {
            type: "string",
            enum: ADDON_RULE_MODEL_RULE_IDS,
          },
          level: { type: "string", enum: ["ERROR", "WARN"] },
          message: {
            type: "string",
            minLength: 1,
            maxLength: MAX_MESSAGE_CHARS,
            pattern: TRIMMED_NON_WHITESPACE_PATTERN,
          },
        },
      },
    },
  },
};

export function buildAddonRuleReviewPrompt(
  params: AddonRuleLlmInput,
  evidenceContexts: readonly AddonRuleEvidenceContext[] = projectAddonRuleEvidence(params.contexts),
): string {
  return [
    `Review Kodi addon submission rules for ${params.repo}#${params.prNumber}.`,
    `Target branch: ${params.baseBranch}`,
    "",
    "Rules source:",
    `${params.rules.kind}: ${params.rules.url}`,
    "",
    params.rules.text,
    "",
    "Exclusive review scope:",
    "- Review only the supplied added-line evidence and changed-path metadata.",
    "- Model-only contextual rule IDs (use exactly one): filesystem-boundaries (runtime access outside add-on-owned storage); download-consent (downloads without prior user consent); executable-execution (downloaded or bundled executable launch); addon-modification (installing or modifying add-ons); direct-database-access (direct Kodi database access); skin-view-sort-mode (forcing skin view or sort modes); usage-analytics (usage analytics or telemetry transmission); obfuscation (obfuscated source behavior).",
    "- Deterministic checks own target branches, development artifacts, binaries, license naming/content, translation paths, addon.xml metadata/dependencies, and line endings. Do not report those deterministic categories.",
    "- Do not report logging API choice (print, xbmc.log), Python version/syntax/type hints, general compatibility/correctness/style/architecture, hard-coded non-UI/log/error strings, localization of Python library strings, test coverage, or dependency-use claims requiring repository-wide evidence.",
    "- Do not review Python or JavaScript correctness, syntax, logic, style, architecture, or maintainability.",
    "- Review content only for addon.xml, Python, and web-interface JavaScript added lines.",
    "- Check only the eight model-only contextual Kodi add-on submission rules defined above.",
    "- Ground every statement and finding in the supplied target branch, changed paths, or added-line evidence.",
    "- Every finding must identify an exact path and line from the supplied added-line evidence. Branch and file-level rules are handled deterministically.",
    "- Use only ERROR or WARN finding levels. Omit uncertain claims unless a WARN clearly states what a human must confirm.",
    "- Do not include an approval, rejection, or merge verdict.",
    "- Do not mention reviewer handles, prior PR backlinks, raw prompts, hidden context, or unverifiable claims.",
    "- Summary must be one to three factual sentences and at most 600 characters.",
    "- Return at most 20 findings; each message must be at most 400 characters.",
    "",
    "Return the result using the supplied JSON schema.",
    "",
    "Changed add-on added-line evidence JSON:",
    JSON.stringify(evidenceContexts),
  ].join("\n");
}

export function validateAddonRuleReviewOutput(
  value: unknown,
  originalContexts: readonly AddonRuleAddonContext[],
): AddonRuleLlmResult {
  try {
    const record = requireExactRecord(value, ["summary", "findings"]);
    const summary = requireBoundedSafeString(record.summary, MAX_SUMMARY_CHARS);
    if (!Array.isArray(record.findings) || record.findings.length > MAX_FINDINGS) {
      throw new Error();
    }

    const pathsByAddon = new Map(
      originalContexts.map((context) => [context.addonId, new Set(context.allChangedPaths)] as const),
    );
    const addedLinesByPath = collectAddedLinesByPath(originalContexts);
    const findings: AddonRuleFinding[] = record.findings.map((item) => {
      const finding = requireExactRecord(item, [
        "addonId",
        "path",
        "line",
        "rule",
        "level",
        "message",
      ]);
      const addonId = requireBoundedSafeString(finding.addonId);
      const path = requireBoundedSafeString(finding.path);
      const rule = requireBoundedSafeString(finding.rule, MAX_RULE_CHARS);
      const message = requireBoundedSafeString(finding.message, MAX_MESSAGE_CHARS);
      const line = finding.line;
      const level = finding.level;

      if (!addonRuleModelRuleIds.has(rule)
        || (level !== "ERROR" && level !== "WARN")
        || typeof line !== "number"
        || !Number.isInteger(line)
        || line < 1
        || !pathsByAddon.get(addonId)?.has(path)
        || !addedLinesByPath.get(addonPathKey(addonId, path))?.has(line)) {
        throw new Error();
      }

      return { addonId, path, line, rule, level, source: "llm", message };
    });

    return { summary, findings };
  } catch {
    throw new Error("Structured addon review output failed domain validation");
  }
}

export function parseAddonRuleReviewOutput(
  text: string,
  contexts: readonly AddonRuleAddonContext[],
): AddonRuleLlmResult {
  try {
    return validateAddonRuleReviewOutput(JSON.parse(extractJsonObject(text)), contexts);
  } catch {
    return { findings: [], rejectedOutput: true };
  }
}

function collectAddedLinesByPath(
  contexts: readonly AddonRuleAddonContext[],
): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const context of projectAddonRuleEvidence(contexts)) {
    for (const file of context.files) {
      result.set(
        addonPathKey(context.addonId, file.path),
        new Set(file.addedLines.map(({ line }) => line)),
      );
    }
  }
  return result;
}

function addonPathKey(addonId: string, path: string): string {
  return `${addonId}\u0000${path}`;
}

function requireExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== keys.length || keys.some((key) => !actualKeys.includes(key))) {
    throw new Error();
  }
  return record;
}

function requireBoundedSafeString(value: unknown, maxLength?: number): string {
  if (typeof value !== "string") throw new Error();
  if (!trimmedNonWhitespace.test(value)
    || (maxLength !== undefined && value.length > maxLength)
    || isUnsafeText(value)) {
    throw new Error();
  }
  return value;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  return trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;
}

function isUnsafeText(value: string): boolean {
  return /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i.test(value)
    || /\b(raw prompt|system prompt|hidden system|hidden context|developer message)\b/i.test(value)
    || /\b(?:sk-[a-z0-9_-]{8,}|TOKEN\s*=|SECRET\s*=)\b/i.test(value);
}
