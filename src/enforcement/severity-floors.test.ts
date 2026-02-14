import { describe, expect, it } from "bun:test";
import {
  matchesPattern,
  severityRank,
  BUILTIN_SEVERITY_PATTERNS,
  enforceSeverityFloors,
} from "./severity-floors.ts";
import type { FindingSeverity, FindingCategory } from "../knowledge/types.ts";
import type { LanguageRulesConfig } from "./types.ts";

// Helper to build a minimal finding
function makeFinding(overrides: {
  filePath: string;
  title: string;
  severity: FindingSeverity;
  category?: FindingCategory;
}) {
  return {
    filePath: overrides.filePath,
    title: overrides.title,
    severity: overrides.severity,
    category: overrides.category ?? ("correctness" as FindingCategory),
  };
}

// ---------------------------------------------------------------------------
// matchesPattern
// ---------------------------------------------------------------------------
describe("matchesPattern", () => {
  it("matches when all keywords in an AND group are present", () => {
    expect(matchesPattern("Potential null pointer dereference", [["null", "pointer"]])).toBe(true);
  });

  it("matches any OR group (first group)", () => {
    expect(
      matchesPattern("Null dereference in handler", [
        ["null", "dereference"],
        ["null", "pointer"],
      ]),
    ).toBe(true);
  });

  it("matches any OR group (second group)", () => {
    expect(
      matchesPattern("Null pointer access", [
        ["null", "dereference"],
        ["null", "pointer"],
      ]),
    ).toBe(true);
  });

  it("rejects when no group fully matches", () => {
    expect(matchesPattern("Consider using const", [["null", "pointer"]])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesPattern("NULL POINTER Dereference", [["null", "pointer"]])).toBe(true);
  });

  it("handles single-keyword groups", () => {
    expect(matchesPattern("NPE when user is null", [["npe"]])).toBe(true);
  });

  it("handles empty keyword group gracefully", () => {
    // An empty AND group means all 0 keywords are present -> vacuously true
    expect(matchesPattern("anything", [[]])).toBe(true);
  });

  it("handles empty keywords array (no groups)", () => {
    expect(matchesPattern("anything", [])).toBe(false);
  });

  it("matches keyword variations for cpp-null-deref pattern", () => {
    const keywords = [["null", "dereference"], ["null", "pointer"], ["nullptr"], ["npe"]];
    expect(matchesPattern("Potential null dereference in handler", keywords)).toBe(true);
    expect(matchesPattern("NPE when user is null", keywords)).toBe(true);
    expect(matchesPattern("Null pointer access before check", keywords)).toBe(true);
    expect(matchesPattern("Missing nullptr check", keywords)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// severityRank
// ---------------------------------------------------------------------------
describe("severityRank", () => {
  it("returns 0 for minor", () => {
    expect(severityRank("minor")).toBe(0);
  });

  it("returns 1 for medium", () => {
    expect(severityRank("medium")).toBe(1);
  });

  it("returns 2 for major", () => {
    expect(severityRank("major")).toBe(2);
  });

  it("returns 3 for critical", () => {
    expect(severityRank("critical")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// BUILTIN_SEVERITY_PATTERNS
// ---------------------------------------------------------------------------
describe("BUILTIN_SEVERITY_PATTERNS", () => {
  it("contains exactly 10 built-in patterns", () => {
    expect(BUILTIN_SEVERITY_PATTERNS).toHaveLength(10);
  });

  const expectedIds = [
    "cpp-null-deref",
    "cpp-uninitialized",
    "go-unchecked-error",
    "python-bare-except",
    "c-null-deref",
    "c-buffer-overflow",
    "rust-unwrap",
    "java-unclosed-resource",
    "sql-injection",
    "ts-unhandled-promise",
  ];

  it.each(expectedIds)("includes pattern '%s'", (id) => {
    expect(BUILTIN_SEVERITY_PATTERNS.find((p) => p.id === id)).toBeDefined();
  });

  it("sql-injection has contextRelaxation.testFiles = false", () => {
    const sqlInjection = BUILTIN_SEVERITY_PATTERNS.find((p) => p.id === "sql-injection");
    expect(sqlInjection?.contextRelaxation?.testFiles).toBe(false);
  });

  it("cpp-null-deref has contextRelaxation.testFiles = true", () => {
    const pattern = BUILTIN_SEVERITY_PATTERNS.find((p) => p.id === "cpp-null-deref");
    expect(pattern?.contextRelaxation?.testFiles).toBe(true);
  });

  it("all non-sql patterns have testFiles = true", () => {
    for (const pattern of BUILTIN_SEVERITY_PATTERNS) {
      if (pattern.id === "sql-injection") continue;
      expect(pattern.contextRelaxation?.testFiles).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// enforceSeverityFloors
// ---------------------------------------------------------------------------
describe("enforceSeverityFloors", () => {
  const defaultFilesByCategory = { test: [] as string[], source: [] as string[] };
  const defaultFilesByLanguage = {};

  describe("C++ null deref elevation", () => {
    it("elevates C++ null deref from minor to critical in production file", () => {
      const findings = [
        makeFinding({
          filePath: "src/parser.cpp",
          title: "Potential null pointer dereference",
          severity: "minor",
          category: "correctness",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { "C++": ["src/parser.cpp"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.originalSeverity).toBe("minor");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("cpp-null-deref");
    });
  });

  describe("test file relaxation", () => {
    it("does NOT elevate C++ null deref in test file", () => {
      const findings = [
        makeFinding({
          filePath: "tests/parser.test.cpp",
          title: "Potential null pointer dereference",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: { test: ["tests/parser.test.cpp"], source: [] },
        filesByLanguage: { "C++": ["tests/parser.test.cpp"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("minor");
      expect(result[0]!.severityElevated).toBe(false);
    });
  });

  describe("Go unchecked error elevation", () => {
    it("elevates Go unchecked error from minor to major", () => {
      const findings = [
        makeFinding({
          filePath: "handlers/auth.go",
          title: "Error return value ignored",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { Go: ["handlers/auth.go"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("major");
      expect(result[0]!.originalSeverity).toBe("minor");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("go-unchecked-error");
    });
  });

  describe("Python bare except elevation", () => {
    it("elevates Python bare except from medium to major", () => {
      const findings = [
        makeFinding({
          filePath: "utils/parser.py",
          title: "Bare except clause catches all exceptions",
          severity: "medium",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { Python: ["utils/parser.py"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("major");
      expect(result[0]!.originalSeverity).toBe("medium");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("python-bare-except");
    });
  });

  describe("finding already at or above floor", () => {
    it("does NOT modify finding already at critical", () => {
      const findings = [
        makeFinding({
          filePath: "src/main.cpp",
          title: "Null pointer access",
          severity: "critical",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { "C++": ["src/main.cpp"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(false);
    });

    it("does NOT modify Go error finding already at major", () => {
      const findings = [
        makeFinding({
          filePath: "handlers/auth.go",
          title: "Error return value ignored",
          severity: "major",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { Go: ["handlers/auth.go"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("major");
      expect(result[0]!.severityElevated).toBe(false);
    });
  });

  describe("user-defined patterns from config", () => {
    it("applies user-defined severity floor pattern", () => {
      const languageRules: LanguageRulesConfig = {
        severityFloors: [
          {
            pattern: "unvalidated input",
            language: "TypeScript",
            minSeverity: "major",
            skipTestFiles: true,
          },
        ],
        toolingOverrides: [],
        disableBuiltinFloors: false,
      };
      const findings = [
        makeFinding({
          filePath: "src/api.ts",
          title: "Unvalidated input passed to database query",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { TypeScript: ["src/api.ts"] },
        languageRules,
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("major");
      expect(result[0]!.severityElevated).toBe(true);
    });
  });

  describe("disableBuiltinFloors", () => {
    it("does NOT apply built-in patterns when disableBuiltinFloors=true", () => {
      const languageRules: LanguageRulesConfig = {
        severityFloors: [],
        toolingOverrides: [],
        disableBuiltinFloors: true,
      };
      const findings = [
        makeFinding({
          filePath: "src/parser.cpp",
          title: "Potential null pointer dereference",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { "C++": ["src/parser.cpp"] },
        languageRules,
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("minor");
      expect(result[0]!.severityElevated).toBe(false);
    });

    it("still applies user-defined patterns when disableBuiltinFloors=true", () => {
      const languageRules: LanguageRulesConfig = {
        severityFloors: [
          {
            pattern: "null pointer",
            language: "C++",
            minSeverity: "critical",
            skipTestFiles: true,
          },
        ],
        toolingOverrides: [],
        disableBuiltinFloors: true,
      };
      const findings = [
        makeFinding({
          filePath: "src/parser.cpp",
          title: "Potential null pointer dereference",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { "C++": ["src/parser.cpp"] },
        languageRules,
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
    });
  });

  describe("unmatched finding passthrough", () => {
    it("passes through unmatched finding unchanged", () => {
      const findings = [
        makeFinding({
          filePath: "src/app.ts",
          title: "Consider using const instead of let",
          severity: "minor",
          category: "style",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { TypeScript: ["src/app.ts"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("minor");
      expect(result[0]!.severityElevated).toBe(false);
      expect(result[0]!.toolingSuppressed).toBe(false);
    });
  });

  describe("C++ uninitialized member elevation", () => {
    it("elevates C++ uninitialized member from minor to critical", () => {
      const findings = [
        makeFinding({
          filePath: "src/widget.cpp",
          title: "Uninitialized member variable in constructor",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { "C++": ["src/widget.cpp"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("cpp-uninitialized");
    });
  });

  describe("C null deref elevation", () => {
    it("elevates C null pointer from minor to critical", () => {
      const findings = [
        makeFinding({
          filePath: "src/parser.c",
          title: "Null pointer dereference after malloc failure",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { C: ["src/parser.c"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("c-null-deref");
    });
  });

  describe("C buffer overflow elevation", () => {
    it("elevates C buffer overflow from medium to critical", () => {
      const findings = [
        makeFinding({
          filePath: "src/util.c",
          title: "Potential buffer overflow in string copy",
          severity: "medium",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { C: ["src/util.c"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("c-buffer-overflow");
    });

    it("elevates C strcpy finding to critical", () => {
      const findings = [
        makeFinding({
          filePath: "src/util.c",
          title: "Use of strcpy without bounds checking",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { C: ["src/util.c"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.enforcementPatternId).toBe("c-buffer-overflow");
    });
  });

  describe("Rust unwrap elevation", () => {
    it("elevates Rust unwrap panic from minor to major", () => {
      const findings = [
        makeFinding({
          filePath: "src/main.rs",
          title: "Unwrap may panic on None value",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { Rust: ["src/main.rs"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("major");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("rust-unwrap");
    });
  });

  describe("Java unclosed resource elevation", () => {
    it("elevates Java resource leak from minor to major", () => {
      const findings = [
        makeFinding({
          filePath: "src/Dao.java",
          title: "Unclosed resource: connection not closed in finally block",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { Java: ["src/Dao.java"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("major");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("java-unclosed-resource");
    });
  });

  describe("SQL injection elevation (any language)", () => {
    it("elevates SQL injection in TypeScript to critical", () => {
      const findings = [
        makeFinding({
          filePath: "src/db.ts",
          title: "SQL injection via string concatenation",
          severity: "medium",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { TypeScript: ["src/db.ts"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("sql-injection");
    });

    it("enforces SQL injection even in test files", () => {
      const findings = [
        makeFinding({
          filePath: "tests/db.test.ts",
          title: "SQL injection via string concatenation",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: { test: ["tests/db.test.ts"], source: [] },
        filesByLanguage: { TypeScript: ["tests/db.test.ts"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("sql-injection");
    });
  });

  describe("TypeScript unhandled promise elevation", () => {
    it("elevates unhandled promise from minor to major", () => {
      const findings = [
        makeFinding({
          filePath: "src/api.ts",
          title: "Unhandled promise rejection in async handler",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { TypeScript: ["src/api.ts"] },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("major");
      expect(result[0]!.severityElevated).toBe(true);
      expect(result[0]!.enforcementPatternId).toBe("ts-unhandled-promise");
    });
  });

  describe("multiple findings", () => {
    it("processes multiple findings independently", () => {
      const findings = [
        makeFinding({
          filePath: "src/parser.cpp",
          title: "Null pointer dereference",
          severity: "minor",
        }),
        makeFinding({
          filePath: "src/app.ts",
          title: "Consider using const",
          severity: "minor",
          category: "style",
        }),
        makeFinding({
          filePath: "handlers/auth.go",
          title: "Error return value ignored",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: {
          "C++": ["src/parser.cpp"],
          TypeScript: ["src/app.ts"],
          Go: ["handlers/auth.go"],
        },
      });
      expect(result).toHaveLength(3);
      // C++ null deref -> critical
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
      // TS style finding -> unchanged
      expect(result[1]!.severity).toBe("minor");
      expect(result[1]!.severityElevated).toBe(false);
      // Go error ignored -> major
      expect(result[2]!.severity).toBe("major");
      expect(result[2]!.severityElevated).toBe(true);
    });
  });

  describe("language filtering", () => {
    it("does NOT apply C++ pattern to Go file", () => {
      const findings = [
        makeFinding({
          filePath: "handlers/auth.go",
          title: "Null pointer dereference",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { Go: ["handlers/auth.go"] },
      });
      expect(result).toHaveLength(1);
      // Go has no null-deref pattern -- should NOT be elevated by cpp-null-deref
      expect(result[0]!.severity).toBe("minor");
      expect(result[0]!.severityElevated).toBe(false);
    });
  });

  describe("user-defined pattern with skipTestFiles", () => {
    it("skips user-defined pattern in test files when skipTestFiles=true", () => {
      const languageRules: LanguageRulesConfig = {
        severityFloors: [
          {
            pattern: "unvalidated input",
            language: "TypeScript",
            minSeverity: "major",
            skipTestFiles: true,
          },
        ],
        toolingOverrides: [],
        disableBuiltinFloors: false,
      };
      const findings = [
        makeFinding({
          filePath: "tests/api.test.ts",
          title: "Unvalidated input passed to handler",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: { test: ["tests/api.test.ts"], source: [] },
        filesByLanguage: { TypeScript: ["tests/api.test.ts"] },
        languageRules,
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("minor");
      expect(result[0]!.severityElevated).toBe(false);
    });

    it("applies user-defined pattern in test files when skipTestFiles=false", () => {
      const languageRules: LanguageRulesConfig = {
        severityFloors: [
          {
            pattern: "hardcoded secret",
            minSeverity: "critical",
            skipTestFiles: false,
          },
        ],
        toolingOverrides: [],
        disableBuiltinFloors: false,
      };
      const findings = [
        makeFinding({
          filePath: "tests/config.test.ts",
          title: "Hardcoded secret in configuration",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: { test: ["tests/config.test.ts"], source: [] },
        filesByLanguage: { TypeScript: ["tests/config.test.ts"] },
        languageRules,
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
    });
  });

  describe("user-defined pattern without language restriction", () => {
    it("matches across any language when language is not specified", () => {
      const languageRules: LanguageRulesConfig = {
        severityFloors: [
          {
            pattern: "hardcoded secret",
            minSeverity: "critical",
            skipTestFiles: false,
          },
        ],
        toolingOverrides: [],
        disableBuiltinFloors: false,
      };
      const findings = [
        makeFinding({
          filePath: "src/config.py",
          title: "Hardcoded secret in configuration",
          severity: "minor",
        }),
      ];
      const result = enforceSeverityFloors({
        findings,
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { Python: ["src/config.py"] },
        languageRules,
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe("critical");
      expect(result[0]!.severityElevated).toBe(true);
    });
  });

  describe("empty findings array", () => {
    it("returns empty array for empty input", () => {
      const result = enforceSeverityFloors({
        findings: [],
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: {},
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("preserves original finding properties", () => {
    it("spreads all original finding properties onto result", () => {
      const finding = {
        filePath: "src/parser.cpp",
        title: "Null pointer dereference",
        severity: "minor" as FindingSeverity,
        category: "correctness" as FindingCategory,
        customField: "preserved",
      };
      const result = enforceSeverityFloors({
        findings: [finding],
        filesByCategory: defaultFilesByCategory,
        filesByLanguage: { "C++": ["src/parser.cpp"] },
      });
      expect(result).toHaveLength(1);
      expect((result[0] as any).customField).toBe("preserved");
      expect(result[0]!.filePath).toBe("src/parser.cpp");
      expect(result[0]!.title).toBe("Null pointer dereference");
    });
  });
});
