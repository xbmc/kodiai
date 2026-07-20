import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
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

export function buildAddonRuleReviewPrompt(params: AddonRuleLlmInput): string {
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
    "- Review only the supplied diff patches and changed-path metadata.",
    "- Do not review Python or JavaScript correctness, syntax, logic, style, architecture, or maintainability.",
    "- Review content only for addon.xml, Python, and web-interface JavaScript patches.",
    "- Check only Kodi addon submission rules: target branch, development artifacts, obfuscation, binaries, licenses, translations, addon.xml metadata, filesystem boundaries, user consent for downloads, executable execution, addon installation or modification, direct database access, forced skin view/sort modes, and analytics.",
    "- Ground every statement and finding in the supplied target branch, changed paths, or patch text.",
    "- Use the new-file/right-side added-line number from a supplied patch. The line is required for every finding about a specific added code line; omit it only for file-level findings or when no added-line coordinate is available.",
    "- Use only ERROR or WARN finding levels. Omit uncertain claims unless a WARN clearly states what a human must confirm.",
    "- Do not include an approval, rejection, or merge verdict.",
    "- Do not mention reviewer handles, prior PR backlinks, raw prompts, hidden context, or unverifiable claims.",
    "- Summary must be one to three factual sentences and at most 600 characters.",
    "- Return at most 20 findings; each message must be at most 400 characters.",
    "",
    "Return only JSON with this shape:",
    '{ "summary": "Factual changed-evidence summary.", "findings": [{ "addonId": "plugin.video.example", "path": "plugin.video.example/default.py", "line": 42, "rule": "skin-view-mode", "level": "ERROR", "message": "Specific rule issue grounded in the patch." }] }',
    "",
    "Changed addon patch context JSON:",
    JSON.stringify(params.contexts, null, 2),
  ].join("\n");
}

export function parseAddonRuleReviewOutput(
  text: string,
  contexts: readonly AddonRuleAddonContext[],
): AddonRuleLlmResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    return { findings: [], rejectedOutput: true };
  }

  if (!parsed || typeof parsed !== "object") {
    return { findings: [], rejectedOutput: true };
  }

  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.findings) || record.findings.length > MAX_FINDINGS) {
    return { findings: [], rejectedOutput: true };
  }

  const result: AddonRuleLlmResult = { findings: [] };
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (summary && summary.length <= MAX_SUMMARY_CHARS && !isUnsafeText(summary)) {
    result.summary = summary;
  } else if (record.summary !== undefined) {
    result.rejectedSummary = true;
  }

  const pathsByAddon = new Map(
    contexts.map((context) => [context.addonId, new Set(context.allChangedPaths)] as const),
  );
  const addedLinesByPath = collectAddedLinesByPath(contexts);

  for (const item of record.findings) {
    if (!item || typeof item !== "object") continue;
    const finding = item as Record<string, unknown>;
    const addonId = safeString(finding.addonId);
    const path = safeString(finding.path);
    const rule = safeString(finding.rule);
    const level = finding.level;
    const message = safeString(finding.message);
    const addonPaths = pathsByAddon.get(addonId);
    const requestedLine = finding.line;
    const line = typeof requestedLine === "number"
      && Number.isInteger(requestedLine)
      && requestedLine > 0
      && path
      && addedLinesByPath.get(addonPathKey(addonId, path))?.has(requestedLine)
      ? requestedLine
      : undefined;

    if (!addonPaths
      || !rule
      || rule.length > MAX_RULE_CHARS
      || (level !== "ERROR" && level !== "WARN")
      || !message
      || message.length > MAX_MESSAGE_CHARS
      || isUnsafeText(rule)
      || isUnsafeText(message)
      || (path && !addonPaths.has(path))) {
      continue;
    }

    result.findings.push({
      addonId,
      ...(path ? { path } : {}),
      ...(line !== undefined ? { line } : {}),
      rule,
      level,
      source: "llm",
      message,
    });
  }

  return result;
}

function collectAddedLinesByPath(
  contexts: readonly AddonRuleAddonContext[],
): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const context of contexts) {
    for (const file of context.files) {
      if (file.patch === undefined) continue;
      result.set(addonPathKey(context.addonId, file.path), collectAddedRightSideLines(file.patch));
    }
  }
  return result;
}

function collectAddedRightSideLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let rightLine: number | undefined;

  for (const patchLine of patch.split("\n")) {
    const hunk = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      rightLine = Number.parseInt(hunk[1]!, 10);
      continue;
    }
    if (rightLine === undefined || patchLine.startsWith("\\ No newline at end of file")) {
      continue;
    }
    if (patchLine.startsWith("-") && !patchLine.startsWith("---")) {
      continue;
    }
    if (patchLine.startsWith("+") && !patchLine.startsWith("+++")) {
      lines.add(rightLine);
    }
    rightLine += 1;
  }

  return lines;
}

function addonPathKey(addonId: string, path: string): string {
  return `${addonId}\u0000${path}`;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
