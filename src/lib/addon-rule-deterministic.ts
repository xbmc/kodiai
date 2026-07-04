import type { AddonRuleFinding } from "./addon-check-formatter.ts";
import type { AddonRuleAddonContext } from "./addon-rule-context.ts";

const DEV_ARTIFACT_PATTERNS = [
  /(^|\/)\.github\//,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)\.pre-commit-config\.ya?ml$/i,
  /(^|\/)(pytest|tox|ruff|mypy|eslint|prettier)\.config\./i,
  /(^|\/)(pyproject\.toml|package-lock\.json|package\.json)$/i,
  /(^|\/)(tests?|specs?)(\/|$)/i,
  /(^|\/).*\.(test|spec)\.py$/i,
];

const ALLOWED_BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
]);

const FORBIDDEN_BINARY_EXTENSIONS = new Set([
  ".dll",
  ".exe",
  ".dylib",
  ".so",
  ".pyd",
  ".bin",
  ".dat",
  ".class",
  ".jar",
]);

const SPDXISH_LICENSE = /^(?:GPL|LGPL|AGPL|MIT|BSD|Apache|MPL|ISC|Unlicense|CC0)(?:[-A-Za-z0-9.]+)?(?:\s+(?:or|and)\s+(?:GPL|LGPL|AGPL|MIT|BSD|Apache|MPL|ISC|Unlicense|CC0)[-A-Za-z0-9.]*)*$/i;

export function runDeterministicAddonRuleChecks(
  contexts: readonly AddonRuleAddonContext[],
): AddonRuleFinding[] {
  const findings: AddonRuleFinding[] = [];

  for (const context of contexts) {
    const changedPaths = context.allChangedPaths;
    for (const changedPath of changedPaths) {
      if (isDevelopmentArtifact(changedPath)) {
        findings.push(error(context.addonId, `Addon includes development-only artifact: ${changedPath}.`));
      }
      if (isForbiddenBinary(changedPath)) {
        findings.push(error(context.addonId, `Forbidden binary file extension in addon submission: ${changedPath}.`));
      }
      if (isInvalidTranslationPath(changedPath)) {
        findings.push(error(context.addonId, `Invalid translation directory path: ${changedPath}; expected resources/language/resource.language.<lc_cc>/strings.po.`));
      }
    }

    if (!context.hasLicenseFile) {
      findings.push(error(context.addonId, "Missing license file in changed addon directory."));
    }

    const addonXml = context.files.find((file) => file.path.endsWith("/addon.xml") && file.content);
    if (addonXml?.content) {
      findings.push(...checkAddonXml(context.addonId, addonXml.content));
    }
  }

  return dedupeFindings(findings);
}

function error(addonId: string, message: string): AddonRuleFinding {
  return { addonId, level: "ERROR", source: "deterministic", message };
}

function warn(addonId: string, message: string): AddonRuleFinding {
  return { addonId, level: "WARN", source: "deterministic", message };
}

function isDevelopmentArtifact(path: string): boolean {
  return DEV_ARTIFACT_PATTERNS.some((pattern) => pattern.test(path));
}

function isForbiddenBinary(path: string): boolean {
  const extension = path.match(/(\.[A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (!extension || ALLOWED_BINARY_EXTENSIONS.has(extension)) return false;
  return FORBIDDEN_BINARY_EXTENSIONS.has(extension);
}

function isInvalidTranslationPath(path: string): boolean {
  if (!path.endsWith("/strings.po")) return false;
  if (!path.includes("/resources/language/")) return false;
  return !/\/resources\/language\/resource\.language\.[a-z]{2}_[a-z]{2}\/strings\.po$/.test(path);
}

function checkAddonXml(addonId: string, xml: string): AddonRuleFinding[] {
  const findings: AddonRuleFinding[] = [];
  if (!hasLocalizedTag(xml, "summary", "en_GB")) {
    findings.push(error(addonId, "addon.xml is missing an English summary tag with lang=\"en_GB\"."));
  }
  if (!hasLocalizedTag(xml, "description", "en_GB")) {
    findings.push(error(addonId, "addon.xml is missing an English description tag with lang=\"en_GB\"."));
  }

  for (const tag of ["summary", "description", "disclaimer"]) {
    const regex = new RegExp(`<${tag}\\b[^>]*\\blang=["']([^"']+)["']`, "gi");
    for (const match of xml.matchAll(regex)) {
      const lang = match[1] ?? "";
      if (!/^[a-z]{2}_[A-Z]{2}$/.test(lang)) {
        findings.push(error(addonId, `addon.xml ${tag} language code "${lang}" must use lc_CC format.`));
      }
    }
  }

  const license = xml.match(/<license\b[^>]*>([\s\S]*?)<\/license>/i)?.[1]?.trim();
  if (!license || !SPDXISH_LICENSE.test(license)) {
    findings.push(warn(addonId, "addon.xml license value does not look like a valid SPDX license identifier."));
  }

  return findings;
}

function hasLocalizedTag(xml: string, tag: string, lang: string): boolean {
  const regex = new RegExp(`<${tag}\\b[^>]*\\blang=["']${escapeRegex(lang)}["'][^>]*>[\\s\\S]*?<\\/${tag}>`, "i");
  return regex.test(xml);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeFindings(findings: readonly AddonRuleFinding[]): AddonRuleFinding[] {
  const seen = new Set<string>();
  const deduped: AddonRuleFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.addonId}|${finding.level}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}
