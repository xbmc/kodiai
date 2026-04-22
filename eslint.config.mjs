import tsParser from "@typescript-eslint/parser";

const typescriptFiles = ["src/**/*.ts", "scripts/**/*.ts"];
const operatorFacingCliFiles = [
  // Migration progress and rollback status are intentionally printed for humans.
  "src/db/migrate.ts",
  // These are operator/entrypoint surfaces that fail loudly on startup problems.
  "src/index.ts",
  "src/config.ts",
  "src/execution/agent-entrypoint.ts",
  // Repo-owned scripts are mostly verifiers/CLI utilities, so console output is expected.
  "scripts/**/*.ts",
];

export default [
  {
    ignores: ["node_modules/**", "tmp/**", ".gsd/**"],
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      // Start with the repo contract this slice actually needs: catch accidental
      // console usage in normal source files without introducing a noisy day-one gate.
      "no-console": "error",
    },
  },
  {
    files: operatorFacingCliFiles,
    rules: {
      // These surfaces intentionally communicate directly with operators.
      "no-console": "off",
    },
  },
];
