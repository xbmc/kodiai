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
  Python: [".black.toml", "pyproject.toml", ".editorconfig"],
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
  Python: ["setup.cfg", "tox.ini", ".flake8", ".pylintrc", "pyproject.toml"],
  Go: [".golangci.yml", ".golangci.yaml", ".golangci.json"],
  Rust: ["clippy.toml", ".clippy.toml"],
};

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
    console.warn(
      "[enforcement] Tooling detection failed, skipping:",
      error instanceof Error ? error.message : String(error),
    );
    return { formatters: new Map(), linters: new Map() };
  }

  return { formatters, linters };
}
