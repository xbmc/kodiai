import { test, expect, describe, mock } from "bun:test";
import {
  sanitizeRule,
  getActiveRulesForPrompt,
  formatActiveRulesSection,
  DEFAULT_ACTIVE_RULES_LIMIT,
  MAX_RULE_TEXT_CHARS,
  type SanitizedActiveRule,
} from "./active-rules.ts";
import type { GeneratedRuleRecord } from "./generated-rule-store.ts";
import type { GeneratedRuleStore } from "./generated-rule-store.ts";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<GeneratedRuleRecord> = {}): GeneratedRuleRecord {
  return {
    id: 1,
    repo: "acme/app",
    title: "Always check null returns",
    ruleText: "When calling optional functions, verify the return value is not null before use.",
    status: "active",
    origin: "generated",
    signalScore: 0.85,
    memberCount: 12,
    clusterCentroid: new Float32Array(0),
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
    activatedAt: "2024-01-02T00:00:00Z",
    retiredAt: null,
    ...overrides,
  };
}

function makeStore(rules: GeneratedRuleRecord[]): GeneratedRuleStore {
  return {
    savePendingRule: mock(() => Promise.resolve(rules[0]!)),
    getRule: mock(() => Promise.resolve(null)),
    listRulesForRepo: mock(() => Promise.resolve(rules)),
    getActiveRulesForRepo: mock((_repo: string, limit?: number) =>
      Promise.resolve(limit ? rules.slice(0, limit) : rules)
    ),
    activateRule: mock(() => Promise.resolve(null)),
    retireRule: mock(() => Promise.resolve(null)),
    getLifecycleCounts: mock(() =>
      Promise.resolve({ pending: 0, active: rules.length, retired: 0, total: rules.length })
    ),
  };
}

function makeSilentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    debug: () => {},
    error: () => {},
    child: () => makeSilentLogger(),
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// sanitizeRule
// ---------------------------------------------------------------------------

describe("sanitizeRule", () => {
  test("passes through clean rule unchanged", () => {
    const rule = makeRule({
      title: "Check error returns",
      ruleText: "Always inspect return values from error-prone calls.",
    });
    const { sanitized, truncated } = sanitizeRule(rule);
    expect(sanitized.title).toBe("Check error returns");
    expect(sanitized.ruleText).toBe("Always inspect return values from error-prone calls.");
    expect(truncated).toBe(false);
  });

  test("strips HTML comments from title and ruleText", () => {
    const rule = makeRule({
      title: "Check<!-- injection -->errors",
      ruleText: "Never trust <!-- hidden instruction -->user input.",
    });
    const { sanitized } = sanitizeRule(rule);
    expect(sanitized.title).toBe("Checkerrors");
    expect(sanitized.ruleText).toBe("Never trust user input.");
  });

  test("redacts GitHub tokens from ruleText", () => {
    // ghp_ requires exactly 36 alphanumeric chars to match
    const rule = makeRule({
      ruleText: "Token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij should not appear.",
    });
    const { sanitized } = sanitizeRule(rule);
    expect(sanitized.ruleText).not.toContain("ghp_");
    expect(sanitized.ruleText).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  test("truncates ruleText exceeding MAX_RULE_TEXT_CHARS and sets truncated=true", () => {
    const longText = "x".repeat(MAX_RULE_TEXT_CHARS + 50);
    const rule = makeRule({ ruleText: longText });
    const { sanitized, truncated } = sanitizeRule(rule);
    expect(truncated).toBe(true);
    // Result length = MAX_RULE_TEXT_CHARS + 1 (for the ellipsis char) or trimEnd may shorten slightly
    expect(sanitized.ruleText.length).toBeLessThanOrEqual(MAX_RULE_TEXT_CHARS + 1);
    expect(sanitized.ruleText.endsWith("…")).toBe(true);
  });

  test("does not truncate ruleText at exactly MAX_RULE_TEXT_CHARS", () => {
    const exactText = "a".repeat(MAX_RULE_TEXT_CHARS);
    const rule = makeRule({ ruleText: exactText });
    const { sanitized, truncated } = sanitizeRule(rule);
    expect(truncated).toBe(false);
    expect(sanitized.ruleText).toBe(exactText);
  });

  test("preserves id, signalScore, memberCount", () => {
    const rule = makeRule({ id: 42, signalScore: 0.91, memberCount: 7 });
    const { sanitized } = sanitizeRule(rule);
    expect(sanitized.id).toBe(42);
    expect(sanitized.signalScore).toBe(0.91);
    expect(sanitized.memberCount).toBe(7);
  });

  test("trims whitespace from sanitized title and ruleText", () => {
    const rule = makeRule({
      title: "  spaced title  ",
      ruleText: "  spaced text  ",
    });
    const { sanitized } = sanitizeRule(rule);
    expect(sanitized.title).toBe("spaced title");
    expect(sanitized.ruleText).toBe("spaced text");
  });
});

// ---------------------------------------------------------------------------
// getActiveRulesForPrompt
// ---------------------------------------------------------------------------

describe("getActiveRulesForPrompt", () => {
  test("returns sanitized rules for a repo", async () => {
    const rules = [
      makeRule({ id: 1, title: "Rule A", ruleText: "Check A." }),
      makeRule({ id: 2, title: "Rule B", ruleText: "Check B." }),
    ];
    const store = makeStore(rules);
    const result = await getActiveRulesForPrompt({
      store,
      repo: "acme/app",
      logger: makeSilentLogger(),
    });
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]!.title).toBe("Rule A");
    expect(result.rules[1]!.title).toBe("Rule B");
    expect(result.truncatedCount).toBe(0);
  });

  test("respects requested limit", async () => {
    const rules = Array.from({ length: 15 }, (_, i) =>
      makeRule({ id: i + 1, title: `Rule ${i + 1}`, ruleText: `Text ${i + 1}` })
    );
    const store = makeStore(rules);
    const result = await getActiveRulesForPrompt({
      store,
      repo: "acme/app",
      logger: makeSilentLogger(),
      limit: 5,
    });
    expect(result.rules).toHaveLength(5);
  });

  test("reports capped totalActive as the lower-bound count fetched past the effective limit", async () => {
    const effectiveLimit = 5;
    const lowerBoundCount = effectiveLimit + 1;
    const rules = Array.from({ length: lowerBoundCount + 4 }, (_, i) =>
      makeRule({ id: i + 1, title: `Rule ${i + 1}`, ruleText: `Text ${i + 1}` })
    );
    const store = makeStore(rules);
    const result = await getActiveRulesForPrompt({
      store,
      repo: "acme/app",
      logger: makeSilentLogger(),
      limit: effectiveLimit,
    });

    expect(store.getActiveRulesForRepo).toHaveBeenCalledWith("acme/app", lowerBoundCount);
    expect(result.rules).toHaveLength(effectiveLimit);
    expect(result.totalActive).toBe(lowerBoundCount);
  });

  test("applies absolute cap of 20 when limit exceeds it", async () => {
    const rules = Array.from({ length: 25 }, (_, i) =>
      makeRule({ id: i + 1, title: `Rule ${i + 1}`, ruleText: `Text ${i + 1}` })
    );
    const store = makeStore(rules);
    const result = await getActiveRulesForPrompt({
      store,
      repo: "acme/app",
      logger: makeSilentLogger(),
      limit: 100,
    });
    expect(result.rules.length).toBeLessThanOrEqual(20);
  });

  test("defaults to DEFAULT_ACTIVE_RULES_LIMIT when no limit given", async () => {
    const rules = Array.from({ length: DEFAULT_ACTIVE_RULES_LIMIT + 5 }, (_, i) =>
      makeRule({ id: i + 1, title: `Rule ${i + 1}`, ruleText: `T${i}` })
    );
    const store = makeStore(rules);
    const result = await getActiveRulesForPrompt({
      store,
      repo: "acme/app",
      logger: makeSilentLogger(),
    });
    expect(result.rules.length).toBeLessThanOrEqual(DEFAULT_ACTIVE_RULES_LIMIT);
  });

  test("counts truncated rules in truncatedCount", async () => {
    const longText = "z".repeat(MAX_RULE_TEXT_CHARS + 100);
    const rules = [
      makeRule({ id: 1, title: "Long Rule", ruleText: longText }),
      makeRule({ id: 2, title: "Short Rule", ruleText: "Short." }),
    ];
    const store = makeStore(rules);
    const result = await getActiveRulesForPrompt({
      store,
      repo: "acme/app",
      logger: makeSilentLogger(),
    });
    expect(result.truncatedCount).toBe(1);
  });

  test("fail-open: returns empty result when store throws", async () => {
    const store = makeStore([]);
    store.getActiveRulesForRepo = mock(() =>
      Promise.reject(new Error("DB unavailable"))
    );
    const result = await getActiveRulesForPrompt({
      store,
      repo: "acme/app",
      logger: makeSilentLogger(),
    });
    expect(result.rules).toHaveLength(0);
    expect(result.totalActive).toBe(0);
    expect(result.truncatedCount).toBe(0);
  });

  test("returns empty result when no active rules exist", async () => {
    const store = makeStore([]);
    const result = await getActiveRulesForPrompt({
      store,
      repo: "acme/app",
      logger: makeSilentLogger(),
    });
    expect(result.rules).toHaveLength(0);
    expect(result.truncatedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatActiveRulesSection
// ---------------------------------------------------------------------------

describe("formatActiveRulesSection", () => {
  test("returns empty string for empty rules array", () => {
    expect(formatActiveRulesSection([])).toBe("");
  });

  test("includes section header and each rule title", () => {
    const rules: SanitizedActiveRule[] = [
      { id: 1, title: "Null check pattern", ruleText: "Always verify null.", signalScore: 0.9, memberCount: 5 },
      { id: 2, title: "Error handling", ruleText: "Wrap async calls.", signalScore: 0.75, memberCount: 3 },
    ];
    const section = formatActiveRulesSection(rules);
    expect(section).toContain("## Generated Review Rules");
    expect(section).toContain("Null check pattern");
    expect(section).toContain("Error handling");
  });

  test("includes signal score formatted to 2 decimal places", () => {
    const rules: SanitizedActiveRule[] = [
      { id: 1, title: "Rule X", ruleText: "Some rule.", signalScore: 0.876, memberCount: 4 },
    ];
    const section = formatActiveRulesSection(rules);
    expect(section).toContain("0.88");
  });

  test("includes rule text content", () => {
    const rules: SanitizedActiveRule[] = [
      { id: 1, title: "Rule Y", ruleText: "Specific instruction here.", signalScore: 0.8, memberCount: 2 },
    ];
    const section = formatActiveRulesSection(rules);
    expect(section).toContain("Specific instruction here.");
  });

  test("mentions signal score context in header", () => {
    const rules: SanitizedActiveRule[] = [
      { id: 1, title: "Rule Z", ruleText: "A rule.", signalScore: 0.5, memberCount: 1 },
    ];
    const section = formatActiveRulesSection(rules);
    expect(section).toContain("signal");
  });
});
