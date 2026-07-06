import { join } from "node:path";
import type { DetectedTooling } from "./types.ts";

/**
 * Mapping of languages to formatter config file names found at workspace root.
 * .editorconfig is included for all languages.
 */
export const FORMATTER_CONFIGS: Record<string, string[]> = {
  JavaScript: [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    ".prettierrc.js",
    ".prettierrc.cjs",
    "prettier.config.js",
    "prettier.config.cjs",
    ".editorconfig",
  ],
  TypeScript: [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    ".prettierrc.js",
    ".prettierrc.cjs",
    "prettier.config.js",
    "prettier.config.cjs",
    ".editorconfig",
  ],
  Python: [".black.toml", ".editorconfig"],
  "C++": [".clang-format", ".editorconfig"],
  C: [".clang-format", ".editorconfig"],
  Go: [".editorconfig"],
  Rust: ["rustfmt.toml", ".rustfmt.toml", ".editorconfig"],
  Java: [".editorconfig", "google-java-format.xml"],
};

/**
 * Mapping of languages to linter config file names found at workspace root.
 */
export const LINTER_CONFIGS: Record<string, string[]> = {
  JavaScript: [
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.yml",
    ".eslintrc.yaml",
    ".eslintrc.cjs",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
  ],
  TypeScript: [
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.yml",
    ".eslintrc.yaml",
    ".eslintrc.cjs",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
  ],
  Python: ["setup.cfg", "tox.ini", ".flake8", ".pylintrc"],
  Go: [".golangci.yml", ".golangci.yaml", ".golangci.json"],
  Rust: ["clippy.toml", ".clippy.toml"],
};

const PYPROJECT_FORMATTER_TOOLS = ["black", "autopep8", "yapf", "ruff.format"];
const PYPROJECT_LINTER_TOOLS = ["ruff", "ruff.lint", "pylint", "flake8"];

function hasPyprojectToolSection(contents: string, toolNames: string[]): boolean {
  return toolNames.some((toolName) => {
    const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\s*\\[tool\\.${escaped}\\]`, "m").test(contents);
  });
}

/**
 * Detect formatter and linter config files in a workspace directory.
 *
 * Checks root-level config files only (where formatters/linters are typically configured).
 * Special cases:
 * - Go: gofmt is built-in, so go.mod presence implies formatter is available.
 *
 * Fail-open: any filesystem error returns empty maps rather than blocking the review.
 */
export async function detectRepoTooling(
  workspaceDir: string,
  logger?: { warn: (obj: unknown, msg: string) => void },
): Promise<DetectedTooling> {
  const formatters = new Map<string, string[]>();
  const linters = new Map<string, string[]>();

  try {
    // Detect formatter configs
    for (const [language, configFiles] of Object.entries(FORMATTER_CONFIGS)) {
      const found: string[] = [];
      for (const configFile of configFiles) {
        const filePath = join(workspaceDir, configFile);
        if (await Bun.file(filePath).exists()) {
          found.push(configFile);
        }
      }
      if (found.length > 0) {
        formatters.set(language, found);
      }
    }

    // Special case: Go always has gofmt when go.mod exists
    const goModPath = join(workspaceDir, "go.mod");
    if (await Bun.file(goModPath).exists()) {
      formatters.set("Go", ["go.mod (gofmt built-in)"]);
    }

    const pyprojectPath = join(workspaceDir, "pyproject.toml");
    const pyprojectFile = Bun.file(pyprojectPath);
    if (await pyprojectFile.exists()) {
      const pyproject = await pyprojectFile.text();
      if (hasPyprojectToolSection(pyproject, PYPROJECT_FORMATTER_TOOLS)) {
        const pythonFormatters = formatters.get("Python") ?? [];
        pythonFormatters.push("pyproject.toml");
        formatters.set("Python", pythonFormatters);
      }
      if (hasPyprojectToolSection(pyproject, PYPROJECT_LINTER_TOOLS)) {
        const pythonLinters = linters.get("Python") ?? [];
        pythonLinters.push("pyproject.toml");
        linters.set("Python", pythonLinters);
      }
    }

    // Detect linter configs
    for (const [language, configFiles] of Object.entries(LINTER_CONFIGS)) {
      const found: string[] = [];
      for (const configFile of configFiles) {
        const filePath = join(workspaceDir, configFile);
        if (await Bun.file(filePath).exists()) {
          found.push(configFile);
        }
      }
      if (found.length > 0) {
        linters.set(language, found);
      }
    }
  } catch (error) {
    // Fail-open: log warning but never block the review
    if (logger) {
      logger.warn({ err: error }, "Tooling detection failed, skipping");
    }
    return { formatters: new Map(), linters: new Map() };
  }

  return { formatters, linters };
}
