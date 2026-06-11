import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

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
  {
    // Floating promises in the service can become unhandledRejection, which
    // the fatal-shutdown handlers turn into a full process exit. Type-aware
    // linting is scoped to src/ — scripts/ is a large verifier tree where the
    // added lint time buys little.
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
];
