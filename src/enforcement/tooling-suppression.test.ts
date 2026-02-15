import { describe, expect, it } from "bun:test";
import {
  suppressToolingFindings,
  isFormattingFinding,
  isImportOrderFinding,
  FORMATTING_KEYWORDS,
  IMPORT_ORDER_KEYWORDS,
} from "./tooling-suppression.ts";
import type { DetectedTooling, LanguageRulesConfig } from "./types.ts";

// Helper to create a minimal finding object
function makeFinding(overrides: {
  filePath: string;
  title: string;
  severity: "critical" | "major" | "medium" | "minor";
  category: "correctness" | "security" | "performance" | "style" | "documentation";
}) {
  return {
    filePath: overrides.filePath,
    title: overrides.title,
    severity: overrides.severity,
    category: overrides.category,
  };
}

function emptyTooling(): DetectedTooling {
  return { formatters: new Map(), linters: new Map() };
}

describe("FORMATTING_KEYWORDS", () => {
  it("is an array of string arrays", () => {
    expect(Array.isArray(FORMATTING_KEYWORDS)).toBe(true);
    for (const group of FORMATTING_KEYWORDS) {
      expect(Array.isArray(group)).toBe(true);
      for (const kw of group) {
        expect(typeof kw).toBe("string");
      }
    }
  });

  it("includes formatting, indentation, bracket placement, line length keywords", () => {
    const flat = FORMATTING_KEYWORDS.flat();
    expect(flat).toContain("formatting");
    expect(flat).toContain("indentation");
    expect(flat).toContain("line");
    expect(flat).toContain("whitespace");
  });
});

describe("IMPORT_ORDER_KEYWORDS", () => {
  it("is an array of string arrays", () => {
    expect(Array.isArray(IMPORT_ORDER_KEYWORDS)).toBe(true);
    for (const group of IMPORT_ORDER_KEYWORDS) {
      expect(Array.isArray(group)).toBe(true);
      for (const kw of group) {
        expect(typeof kw).toBe("string");
      }
    }
  });

  it("includes import order, import sort keywords", () => {
    const flat = IMPORT_ORDER_KEYWORDS.flat();
    expect(flat).toContain("import");
    expect(flat).toContain("order");
    expect(flat).toContain("sort");
  });
});

describe("isFormattingFinding", () => {
  it("returns true for titles containing formatting keywords", () => {
    expect(isFormattingFinding("Inconsistent indentation style")).toBe(true);
    expect(isFormattingFinding("Line exceeds maximum length")).toBe(true);
    expect(isFormattingFinding("Bracket placement inconsistency")).toBe(true);
    expect(isFormattingFinding("Trailing comma missing")).toBe(true);
    expect(isFormattingFinding("Whitespace issue found")).toBe(true);
    expect(isFormattingFinding("Inconsistent formatting detected")).toBe(true);
    expect(isFormattingFinding("Wrong quote style used")).toBe(true);
    expect(isFormattingFinding("Tab versus spaces inconsistency")).toBe(true);
    expect(isFormattingFinding("Missing newline at end of file")).toBe(true);
    expect(isFormattingFinding("Semicolon usage inconsistency")).toBe(true);
    expect(isFormattingFinding("Spacing around operators")).toBe(true);
    expect(isFormattingFinding("Brace style violation")).toBe(true);
  });

  it("returns false for non-formatting titles", () => {
    expect(isFormattingFinding("Possible null reference error")).toBe(false);
    expect(isFormattingFinding("SQL injection vulnerability")).toBe(false);
    expect(isFormattingFinding("Missing error handling")).toBe(false);
    expect(isFormattingFinding("Unused variable detected")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isFormattingFinding("INCONSISTENT INDENTATION")).toBe(true);
    expect(isFormattingFinding("Line LENGTH exceeds limit")).toBe(true);
  });
});

describe("isImportOrderFinding", () => {
  it("returns true for import-order titles", () => {
    expect(isImportOrderFinding("Import statements should be sorted alphabetically")).toBe(true);
    expect(isImportOrderFinding("Import order is wrong")).toBe(true);
    expect(isImportOrderFinding("Imports should be grouped by type")).toBe(true);
    expect(isImportOrderFinding("Please arrange imports properly")).toBe(true);
    expect(isImportOrderFinding("Sorted imports expected")).toBe(true);
    expect(isImportOrderFinding("Organize imports by module type")).toBe(true);
  });

  it("returns false for non-import-order titles", () => {
    expect(isImportOrderFinding("Unused import detected")).toBe(false);
    expect(isImportOrderFinding("Missing import statement")).toBe(false);
    expect(isImportOrderFinding("Possible null reference error")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isImportOrderFinding("IMPORT ORDER violation")).toBe(true);
    expect(isImportOrderFinding("Import Sort required")).toBe(true);
  });
});

describe("suppressToolingFindings", () => {
  describe("Case 1: Formatting finding with formatter detected", () => {
    it("suppresses formatting finding in TypeScript when .prettierrc exists", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Inconsistent indentation style",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(true);
    });
  });

  describe("Case 2: Import ordering finding with linter detected", () => {
    it("suppresses import-order finding in TypeScript when eslint config exists", () => {
      const tooling: DetectedTooling = {
        formatters: new Map(),
        linters: new Map([["TypeScript", [".eslintrc.json"]]]),
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Import statements should be sorted alphabetically",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(true);
    });
  });

  describe("Case 3: Correctness finding NOT suppressed", () => {
    it("does not suppress correctness finding even when prettier exists", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Possible null reference error",
          severity: "major",
          category: "correctness",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(false);
    });
  });

  describe("Case 4: Python formatting finding with Black", () => {
    it("suppresses formatting finding in Python when .black.toml exists", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["Python", [".black.toml"]]]),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "utils/parser.py",
          title: "Line exceeds maximum length",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(true);
    });
  });

  describe("Case 5: C++ formatting finding with clang-format", () => {
    it("suppresses formatting finding in C++ when .clang-format exists", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["C++", [".clang-format"]]]),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "src/parser.cpp",
          title: "Bracket placement inconsistency",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(true);
    });
  });

  describe("Case 6: Go formatting finding (gofmt built-in)", () => {
    it("suppresses formatting finding in Go when go.mod detected", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["Go", ["go.mod (gofmt built-in)"]]]),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "handlers/auth.go",
          title: "Formatting does not match gofmt standard",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(true);
    });
  });

  describe("Case 7: No formatter detected - pass through", () => {
    it("does not suppress formatting finding when no formatter exists for language", () => {
      const tooling: DetectedTooling = {
        formatters: new Map(),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "src/lib.rs",
          title: "Inconsistent indentation",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(false);
    });
  });

  describe("Case 8: User override disables formatting suppression", () => {
    it("does not suppress formatting when user sets suppressFormatting=false", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map(),
      };
      const languageRules: LanguageRulesConfig = {
        severityFloors: [],
        toolingOverrides: [
          {
            language: "TypeScript",
            suppressFormatting: false,
            suppressImportOrder: true,
          },
        ],
        disableBuiltinFloors: false,
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Inconsistent indentation style",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({
        findings,
        detectedTooling: tooling,
        languageRules,
      });
      expect(result[0]!.toolingSuppressed).toBe(false);
    });
  });

  describe("Case 9: User override disables import-order suppression", () => {
    it("does not suppress import-order when user sets suppressImportOrder=false", () => {
      const tooling: DetectedTooling = {
        formatters: new Map(),
        linters: new Map([["TypeScript", [".eslintrc.json"]]]),
      };
      const languageRules: LanguageRulesConfig = {
        severityFloors: [],
        toolingOverrides: [
          {
            language: "TypeScript",
            suppressFormatting: true,
            suppressImportOrder: false,
          },
        ],
        disableBuiltinFloors: false,
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Import order is wrong",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({
        findings,
        detectedTooling: tooling,
        languageRules,
      });
      expect(result[0]!.toolingSuppressed).toBe(false);
    });
  });

  describe("Case 10: Unknown language passes through without error", () => {
    it("does not crash and does not suppress findings for unknown languages", () => {
      const tooling = emptyTooling();
      const findings = [
        makeFinding({
          filePath: "src/main.zig",
          title: "Style issue",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result).toHaveLength(1);
      expect(result[0]!.toolingSuppressed).toBe(false);
    });
  });

  describe("Category guard: never suppress non-style/documentation findings", () => {
    it("does not suppress security findings even if title matches formatting keywords", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Formatting of security token is incorrect",
          severity: "major",
          category: "security",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(false);
    });

    it("does not suppress performance findings", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Whitespace in regex causes performance issue",
          severity: "major",
          category: "performance",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("returns empty array when given empty findings", () => {
      const result = suppressToolingFindings({
        findings: [],
        detectedTooling: emptyTooling(),
      });
      expect(result).toEqual([]);
    });

    it("preserves all original finding properties", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map(),
      };
      const original = {
        filePath: "src/app.ts",
        title: "Inconsistent indentation style",
        severity: "minor" as const,
        category: "style" as const,
        extraProp: "should be preserved",
      };

      const result = suppressToolingFindings({
        findings: [original],
        detectedTooling: tooling,
      });
      expect(result[0]!.filePath).toBe("src/app.ts");
      expect(result[0]!.title).toBe("Inconsistent indentation style");
      expect(result[0]!.severity).toBe("minor");
      expect(result[0]!.category).toBe("style");
      expect((result[0] as any).extraProp).toBe("should be preserved");
      expect(result[0]!.toolingSuppressed).toBe(true);
    });

    it("handles multiple findings with mixed suppression", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map([["TypeScript", [".eslintrc.json"]]]),
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Inconsistent indentation style",
          severity: "minor",
          category: "style",
        }),
        makeFinding({
          filePath: "src/app.ts",
          title: "Possible null reference error",
          severity: "major",
          category: "correctness",
        }),
        makeFinding({
          filePath: "src/app.ts",
          title: "Import order is wrong",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(true);  // formatting -> suppressed
      expect(result[1]!.toolingSuppressed).toBe(false);  // correctness -> not suppressed
      expect(result[2]!.toolingSuppressed).toBe(true);  // import order -> suppressed
    });

    it("handles documentation category findings for formatting suppression", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map(),
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Inconsistent indentation in docstring",
          severity: "minor",
          category: "documentation",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(true);
    });

    it("does not suppress a style finding that is not a formatting or import-order finding", () => {
      const tooling: DetectedTooling = {
        formatters: new Map([["TypeScript", [".prettierrc"]]]),
        linters: new Map([["TypeScript", [".eslintrc.json"]]]),
      };
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Variable name does not follow naming convention",
          severity: "minor",
          category: "style",
        }),
      ];

      const result = suppressToolingFindings({ findings, detectedTooling: tooling });
      expect(result[0]!.toolingSuppressed).toBe(false);
    });
  });
});
