import { describe, expect, test, mock } from "bun:test";
import { createGuardrailAuditStore } from "./audit-store.ts";
import type { AuditRecord } from "./types.ts";

describe("createGuardrailAuditStore", () => {
  test("returns object with logRun method", () => {
    const mockSql = mock(() => Promise.resolve([])) as any;
    const store = createGuardrailAuditStore(mockSql);
    expect(store).toHaveProperty("logRun");
    expect(typeof store.logRun).toBe("function");
  });

  test("logRun calls sql with correct parameters", async () => {
    const insertedRows: any[] = [];
    // Mock tagged template literal sql function
    const mockSql = Object.assign(
      (strings: TemplateStringsArray, ...values: any[]) => {
        insertedRows.push({ strings: [...strings], values });
        return Promise.resolve([]);
      },
      {},
    ) as any;

    const store = createGuardrailAuditStore(mockSql);

    const record: AuditRecord = {
      surface: "pr-review",
      repo: "owner/repo",
      strictness: "standard",
      claimsTotal: 10,
      claimsGrounded: 7,
      claimsRemoved: 2,
      claimsAmbiguous: 1,
      llmFallbackUsed: false,
      responseSuppressed: false,
      classifierError: false,
      removedClaims: [
        { text: "claim1", label: "external-knowledge", evidence: "version ref" },
      ],
      durationMs: 42,
    };

    // logRun is fire-and-forget so we just call it
    store.logRun(record);

    // Give the promise a tick to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(insertedRows.length).toBe(1);
    // Verify values include the record fields
    const values = insertedRows[0].values;
    expect(values).toContain("pr-review");
    expect(values).toContain("owner/repo");
    expect(values).toContain("standard");
    expect(values).toContain(10);
    expect(values).toContain(7);
    expect(values).toContain(2);
    expect(values).toContain(1);
    expect(values).toContain(false);
    expect(values).toContain(42);
  });

  test("logRun does not throw on sql error (fire-and-forget)", () => {
    const mockSql = Object.assign(
      (_strings: TemplateStringsArray, ..._values: any[]) => {
        return Promise.reject(new Error("DB connection failed"));
      },
      {},
    ) as any;

    const store = createGuardrailAuditStore(mockSql);

    // Should not throw
    expect(() => store.logRun({
      surface: "test",
      repo: "test/repo",
      strictness: "standard",
      claimsTotal: 0,
      claimsGrounded: 0,
      claimsRemoved: 0,
      claimsAmbiguous: 0,
      llmFallbackUsed: false,
      responseSuppressed: false,
      classifierError: false,
      removedClaims: [],
      durationMs: 0,
    })).not.toThrow();
  });
});
