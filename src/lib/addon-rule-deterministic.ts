import type { AddonRuleAddonContext, AddonRuleFileContext } from "./addon-rule-context.ts";
import type { AddonRuleFinding } from "./addon-rule-types.ts";

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
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
  ".ttf", ".otf", ".woff", ".woff2",
]);

const FORBIDDEN_BINARY_EXTENSIONS = new Set([
  ".dll", ".exe", ".dylib", ".so", ".pyd", ".bin", ".dat", ".class", ".jar",
]);

const SPDXISH_LICENSE = /^(?:GPL|LGPL|AGPL|MIT|BSD|Apache|MPL|ISC|Unlicense|CC0)(?:[-A-Za-z0-9.]+)?(?:\s+(?:or|and)\s+(?:GPL|LGPL|AGPL|MIT|BSD|Apache|MPL|ISC|Unlicense|CC0)[-A-Za-z0-9.]*)*$/i;

export function runDeterministicAddonRuleChecks(params: {
  baseBranch: string;
  validBranches: readonly string[];
  contexts: readonly AddonRuleAddonContext[];
}): AddonRuleFinding[] {
  const findings: AddonRuleFinding[] = [];
  const validBranch = params.validBranches.includes(params.baseBranch);

  for (const context of params.contexts) {
    if (!validBranch) {
      findings.push(error(
        context.addonId,
        "target-branch",
        `Target branch "${params.baseBranch}" is not an allowed Kodi add-on submission branch (minimum: matrix).`,
      ));
    }

    for (const changedPath of context.allChangedPaths) {
      if (isDevelopmentArtifact(changedPath)) {
        findings.push(error(
          context.addonId,
          "development-artifact",
          `Addon includes development-only artifact: ${changedPath}.`,
          changedPath,
        ));
      }
      if (isForbiddenBinary(changedPath)) {
        findings.push(error(
          context.addonId,
          "forbidden-binary",
          `Forbidden binary file extension in addon submission: ${changedPath}.`,
          changedPath,
        ));
      }
      if (isInvalidTranslationPath(changedPath)) {
        findings.push(error(
          context.addonId,
          "translation-path",
          `Invalid translation directory path: ${changedPath}; expected resources/language/resource.language.<lc_cc>/strings.po.`,
          changedPath,
        ));
      }
    }

    const addonXml = context.files.find((file) => file.path.toLowerCase().endsWith("/addon.xml"));
    if (addonXml?.status === "added" && !context.allChangedPaths.some(isLicensePath)) {
      findings.push(error(
        context.addonId,
        "license-file",
        "A newly submitted addon must add an open-source license file.",
      ));
    }

    if (addonXml?.patch && addonXml.omittedReason !== "truncated") {
      findings.push(...checkAddonXmlPatch(context.addonId, addonXml));
    }
  }

  return dedupeFindings(findings);
}

function error(addonId: string, rule: string, message: string, path?: string): AddonRuleFinding {
  return { addonId, ...(path ? { path } : {}), rule, level: "ERROR", source: "deterministic", message };
}

function warn(addonId: string, rule: string, message: string, path?: string): AddonRuleFinding {
  return { addonId, ...(path ? { path } : {}), rule, level: "WARN", source: "deterministic", message };
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
  if (!path.endsWith("/strings.po") || !path.includes("/resources/language/")) return false;
  return !/\/resources\/language\/resource\.language\.[a-z]{2}_[a-z]{2}\/strings\.po$/.test(path);
}

function isLicensePath(path: string): boolean {
  const filename = path.split("/").pop() ?? "";
  return /^(licen[sc]e|copying)(?:\.[A-Za-z0-9]+)?$/i.test(filename);
}

function checkAddonXmlPatch(addonId: string, file: AddonRuleFileContext): AddonRuleFinding[] {
  const addedXml = extractAddedLines(file.patch ?? "");
  const findings: AddonRuleFinding[] = [];

  if (file.status === "added") {
    if (!hasLocalizedTag(addedXml, "summary", "en_GB")) {
      findings.push(error(addonId, "manifest-english-summary", "Added addon.xml is missing an English summary tag with lang=\"en_GB\".", file.path));
    }
    if (!hasLocalizedTag(addedXml, "description", "en_GB")) {
      findings.push(error(addonId, "manifest-english-description", "Added addon.xml is missing an English description tag with lang=\"en_GB\".", file.path));
    }
  }

  for (const tag of ["summary", "description", "disclaimer"]) {
    const regex = new RegExp(`<${tag}\\b[^>]*\\blang=["']([^"']+)["']`, "gi");
    for (const match of addedXml.matchAll(regex)) {
      const lang = match[1] ?? "";
      if (!/^[a-z]{2}_[A-Z]{2}$/.test(lang)) {
        findings.push(error(
          addonId,
          "manifest-language-code",
          `addon.xml ${tag} language code "${lang}" must use lc_CC format.`,
          file.path,
        ));
      }
    }
  }

  const license = addedXml.match(/<license\b[^>]*>([\s\S]*?)<\/license>/i)?.[1]?.trim();
  if (license !== undefined && (!license || !SPDXISH_LICENSE.test(license))) {
    findings.push(warn(
      addonId,
      "manifest-license-spdx",
      "Changed addon.xml license value does not look like a valid SPDX license identifier.",
      file.path,
    ));
  }

  return findings;
}

function extractAddedLines(patch: string): string {
  return patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
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
  return findings.filter((finding) => {
    const key = `${finding.addonId}|${finding.path ?? ""}|${finding.rule}|${finding.level}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
