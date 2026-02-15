import { describe, test, expect } from "bun:test";
import { buildRetrievalQuery, type RetrievalQuerySignals } from "./retrieval-query.ts";

describe("buildRetrievalQuery", () => {
  test("minimal input — only prTitle and empty arrays — returns just the title", () => {
    const signals: RetrievalQuerySignals = {
      prTitle: "Fix null pointer in user service",
      detectedLanguages: [],
      riskSignals: [],
      topFilePaths: [],
    };
    const result = buildRetrievalQuery(signals);
    expect(result).toBe("Fix null pointer in user service");
  });

  test("full signals — query includes all signal types", () => {
    const signals: RetrievalQuerySignals = {
      prTitle: "Add JWT refresh rotation",
      prBody: "Implements token refresh with rotation to prevent replay attacks",
      conventionalType: "feat",
      detectedLanguages: ["TypeScript", "Python"],
      riskSignals: ["Modifies authentication/authorization code"],
      authorTier: "first-time",
      topFilePaths: ["src/auth/jwt.ts", "src/auth/refresh.ts"],
    };
    const result = buildRetrievalQuery(signals);

    expect(result).toContain("Add JWT refresh rotation");
    expect(result).toContain("Implements token refresh with rotation");
    expect(result).toContain("[feat]");
    expect(result).toContain("Languages: TypeScript, Python");
    expect(result).toContain("Risk: Modifies authentication/authorization code");
    expect(result).toContain("Author: first-time");
    expect(result).toContain("src/auth/jwt.ts");
    expect(result).toContain("src/auth/refresh.ts");
  });

  test("body truncation — 500-char body only includes first ~200 chars", () => {
    const longBody = "A".repeat(500);
    const signals: RetrievalQuerySignals = {
      prTitle: "Test PR",
      prBody: longBody,
      detectedLanguages: [],
      riskSignals: [],
      topFilePaths: [],
    };
    const result = buildRetrievalQuery(signals);

    // Body portion should be at most 200 chars
    // Remove the title line to isolate body
    const lines = result.split("\n");
    const bodyLine = lines[1]; // second line is body excerpt
    expect(bodyLine!.length).toBeLessThanOrEqual(200);
    expect(result).not.toContain("A".repeat(201));
  });

  test("language cap — 8 detected languages only includes first 5", () => {
    const signals: RetrievalQuerySignals = {
      prTitle: "Polyglot PR",
      detectedLanguages: ["TypeScript", "Python", "Go", "Rust", "Java", "Kotlin", "Swift", "C#"],
      riskSignals: [],
      topFilePaths: [],
    };
    const result = buildRetrievalQuery(signals);

    expect(result).toContain("TypeScript");
    expect(result).toContain("Java");
    expect(result).not.toContain("Kotlin");
    expect(result).not.toContain("Swift");
    expect(result).not.toContain("C#");
  });

  test("risk signal cap — 6 risk signals only includes first 3", () => {
    const signals: RetrievalQuerySignals = {
      prTitle: "Risky PR",
      detectedLanguages: [],
      riskSignals: [
        "Modifies authentication/authorization code",
        "Touches credential/secret-related files",
        "Modifies dependency manifest",
        "Changes CI/CD or infrastructure configuration",
        "Modifies database schema or migrations",
        "Modifies error handling logic",
      ],
      topFilePaths: [],
    };
    const result = buildRetrievalQuery(signals);

    expect(result).toContain("Modifies authentication/authorization code");
    expect(result).toContain("Touches credential/secret-related files");
    expect(result).toContain("Modifies dependency manifest");
    expect(result).not.toContain("Changes CI/CD or infrastructure configuration");
    expect(result).not.toContain("Modifies database schema or migrations");
    expect(result).not.toContain("Modifies error handling logic");
  });

  test("file path cap — 25 file paths only includes first 15", () => {
    const paths = Array.from({ length: 25 }, (_, i) => `src/module-${i}/index.ts`);
    const signals: RetrievalQuerySignals = {
      prTitle: "Many files",
      detectedLanguages: [],
      riskSignals: [],
      topFilePaths: paths,
    };
    const result = buildRetrievalQuery(signals);

    expect(result).toContain("src/module-0/index.ts");
    expect(result).toContain("src/module-14/index.ts");
    expect(result).not.toContain("src/module-15/index.ts");
    expect(result).not.toContain("src/module-24/index.ts");
  });

  test("total length cap — very long inputs capped at ~800 chars", () => {
    const signals: RetrievalQuerySignals = {
      prTitle: "A very important PR with a moderately long title that describes changes",
      prBody: "This is a detailed description of the changes being made. ".repeat(5),
      conventionalType: "feat",
      detectedLanguages: ["TypeScript", "Python", "Go", "Rust", "Java"],
      riskSignals: ["Modifies authentication/authorization code", "Touches credential/secret-related files", "Modifies dependency manifest"],
      authorTier: "established",
      topFilePaths: Array.from({ length: 15 }, (_, i) => `src/very/long/path/to/deeply/nested/module-${i}/implementation.ts`),
    };
    const result = buildRetrievalQuery(signals);

    expect(result.length).toBeLessThanOrEqual(800);
    // Title should always be preserved (highest priority)
    expect(result).toContain("A very important PR");
  });

  test("null conventional type — omitted from output", () => {
    const signals: RetrievalQuerySignals = {
      prTitle: "Some PR",
      conventionalType: null,
      detectedLanguages: [],
      riskSignals: [],
      topFilePaths: [],
    };
    const result = buildRetrievalQuery(signals);

    expect(result).not.toContain("[");
    expect(result).not.toContain("]");
    expect(result).toBe("Some PR");
  });

  test("undefined conventional type — omitted from output", () => {
    const signals: RetrievalQuerySignals = {
      prTitle: "Some PR",
      detectedLanguages: [],
      riskSignals: [],
      topFilePaths: [],
    };
    const result = buildRetrievalQuery(signals);
    expect(result).not.toContain("[");
  });

  test("empty body string — not added to output", () => {
    const signals: RetrievalQuerySignals = {
      prTitle: "PR with empty body",
      prBody: "",
      detectedLanguages: [],
      riskSignals: [],
      topFilePaths: [],
    };
    const result = buildRetrievalQuery(signals);

    expect(result).toBe("PR with empty body");
  });
});
