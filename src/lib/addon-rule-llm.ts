import type { AddonRuleAddonContext } from "./addon-rule-context.ts";
import type { AddonRuleSource } from "./addon-rule-source.ts";
import type { AddonRuleFinding } from "./addon-rule-types.ts";

export type AddonRuleLlmInput = {
  repo: string;
  prNumber: number;
  rules: AddonRuleSource;
  contexts: readonly AddonRuleAddonContext[];
};

export function buildAddonRuleReviewPrompt(params: AddonRuleLlmInput): string {
  const lines: string[] = [
    `Review Kodi addon submission rules for ${params.repo}#${params.prNumber}.`,
    "",
    "Rules source:",
    `${params.rules.kind}: ${params.rules.url}`,
    "",
    params.rules.text,
    "",
    "Scope:",
    "- Prefer Kodi addon submission-rule findings over generic Python style/correctness feedback.",
    "- Full changed files are provided when available; ground every finding in this content or the changed file list.",
    "- Use only ERROR or WARN levels.",
    "- Do not include a merge verdict.",
    "- Do not mention reviewer handles, prior PR backlinks, raw prompts, hidden system context, or unverifiable claims.",
    "",
    "Return only JSON with this shape:",
    '{ "findings": [{ "addonId": "plugin.video.example", "level": "ERROR", "message": "Specific rule issue." }] }',
    "",
    "Changed addon context JSON:",
    JSON.stringify(params.contexts, null, 2),
  ];

  return lines.join("\n");
}

export function parseAddonRuleReviewOutput(text: string): AddonRuleFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { findings?: unknown }).findings)) {
    return [];
  }

  const findings: AddonRuleFinding[] = [];
  for (const item of (parsed as { findings: unknown[] }).findings) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const addonId = typeof record.addonId === "string" ? record.addonId.trim() : "";
    const level = record.level;
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (!addonId || (level !== "ERROR" && level !== "WARN") || !message || isUnsafeFindingMessage(message)) {
      continue;
    }
    findings.push({ addonId, level, source: "llm", message });
  }

  return findings;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? trimmed;
}

function isUnsafeFindingMessage(message: string): boolean {
  return /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i.test(message)
    || /\b(raw prompt|system prompt|hidden system|developer message)\b/i.test(message);
}
