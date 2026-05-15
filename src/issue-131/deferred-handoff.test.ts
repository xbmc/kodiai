import { describe, expect, test } from "bun:test";

import {
  ISSUE_131_DEFERRED_HANDOFF_ROW_IDS,
  ISSUE_131_DEFERRED_HANDOFF_ROWS,
  ISSUE_131_R104_OWNER,
  findForbiddenDeferredHandoffFields,
  validateIssue131DeferredHandoffRows,
  type Issue131DeferredHandoffRow,
} from "./deferred-handoff.ts";

function handoffRow(id: string) {
  const row = ISSUE_131_DEFERRED_HANDOFF_ROWS.find((entry) => entry.rowId === id);
  expect(row).toBeDefined();
  return row!;
}

function mutableRows(): Issue131DeferredHandoffRow[] {
  return ISSUE_131_DEFERRED_HANDOFF_ROWS.map((row) => ({
    ...row,
    requirementRefs: [...row.requirementRefs],
    owner: { ...row.owner },
  }));
}

describe("issue #131 deferred handoff contract", () => {
  test("exports stable row ids for the four deferred issue #131 rows plus R104 ownership", () => {
    expect(ISSUE_131_DEFERRED_HANDOFF_ROW_IDS).toEqual([
      "candidate-finding-mcp-publication-bridge",
      "reducer-extraction",
      "specialist-lane-proof",
      "metrics-tier-closure",
      "repo-doctrine-contract-ownership",
    ]);
    expect(ISSUE_131_DEFERRED_HANDOFF_ROWS.map((row) => row.rowId)).toEqual([...ISSUE_131_DEFERRED_HANDOFF_ROW_IDS]);
  });

  test("preserves exact downstream owners for existing M072-M075 deferred rows", () => {
    expect(handoffRow("candidate-finding-mcp-publication-bridge")).toMatchObject({
      requirementRefs: ["R130"],
      owner: { milestone: "M072", slice: "S01" },
    });
    expect(handoffRow("reducer-extraction")).toMatchObject({
      requirementRefs: ["R130", "R132"],
      owner: { milestone: "M073", slice: "S01" },
    });
    expect(handoffRow("specialist-lane-proof")).toMatchObject({
      requirementRefs: ["R131", "R104"],
      owner: { milestone: "M074", slice: "S01" },
    });
    expect(handoffRow("metrics-tier-closure")).toMatchObject({
      requirementRefs: ["R133"],
      owner: { milestone: "M075", slice: "S01" },
    });
  });

  test("re-owns R104 outside M071 without marking repo doctrine implemented", () => {
    expect(ISSUE_131_R104_OWNER).toMatchObject({
      rowId: "repo-doctrine-contract-ownership",
      requirementRefs: ["R104"],
      owner: { milestone: "M074", slice: "S01" },
      consumerOwnerLabel: "M074/S01 repo-doctrine contract implementation owner",
    });
    expect(ISSUE_131_R104_OWNER.owner.milestone).not.toBe("M071");
    expect(ISSUE_131_R104_OWNER.proofRequiredBeforePromotion).toContain(".kodiai.yml");
    expect(ISSUE_131_R104_OWNER.proofRequiredBeforePromotion).toContain("ReviewPlan/reducer consumption");
    expect(ISSUE_131_R104_OWNER.reason).toContain("unimplemented in M071");
  });

  test("validates the source contract without planning artifact evidence dependencies", () => {
    const validation = validateIssue131DeferredHandoffRows(ISSUE_131_DEFERRED_HANDOFF_ROWS);

    expect(validation).toEqual({ passed: true, reasons: [] });
    for (const row of ISSUE_131_DEFERRED_HANDOFF_ROWS) {
      expect(`${row.consumerOwnerLabel}\n${row.proofRequiredBeforePromotion}\n${row.reason}`).not.toContain(".gsd/");
      expect(`${row.consumerOwnerLabel}\n${row.proofRequiredBeforePromotion}\n${row.reason}`).not.toContain(".planning/");
      expect(`${row.consumerOwnerLabel}\n${row.proofRequiredBeforePromotion}\n${row.reason}`).not.toContain(".audits/");
    }
  });

  test("fails malformed handoff row missing owner", () => {
    const rows = mutableRows();
    rows[0] = { ...rows[0]!, owner: { milestone: "" as never, slice: "" as never } };

    const validation = validateIssue131DeferredHandoffRows(rows);

    expect(validation.passed).toBe(false);
    expect(validation.reasons.join("\n")).toContain("candidate-finding-mcp-publication-bridge: owner milestone and slice are required");
  });

  test("fails when an R104 handoff row points at M071", () => {
    const rows = mutableRows();
    rows[4] = { ...rows[4]!, owner: { milestone: "M071" as never, slice: "S06" } };

    const validation = validateIssue131DeferredHandoffRows(rows);

    expect(validation.passed).toBe(false);
    expect(validation.reasons.join("\n")).toContain("repo-doctrine-contract-ownership: deferred handoff rows must not be owned by M071");
    expect(validation.reasons.join("\n")).toContain("repo-doctrine-contract-ownership: R104 must not be owned by M071");
  });

  test("fails forbidden planning evidence paths in proof text", () => {
    const rows = mutableRows();
    rows[4] = { ...rows[4]!, proofRequiredBeforePromotion: "Promote from .gsd/milestones/M071/M071-VALIDATION.md planning evidence only." };

    const validation = validateIssue131DeferredHandoffRows(rows);

    expect(validation.passed).toBe(false);
    expect(validation.reasons.join("\n")).toContain("repo-doctrine-contract-ownership: handoff proof must not depend on planning artifact paths");
  });

  test("fails unsafe raw prompt, diff, comment, and model-like field names", () => {
    expect(findForbiddenDeferredHandoffFields({ safe: true })).toEqual([]);
    expect(findForbiddenDeferredHandoffFields({ rows: [{ rowId: "x", rawPrompt: "secret", diff: "patch", commentBody: "body", modelOutput: "text" }] })).toEqual([
      "$.rows[0].rawPrompt",
      "$.rows[0].diff",
      "$.rows[0].commentBody",
      "$.rows[0].modelOutput",
    ]);

    const unsafeRows = [
      ...mutableRows(),
      {
        rowId: "unsafe-extra-row",
        requirementRefs: ["R104"],
        owner: { milestone: "M074", slice: "S01" },
        consumerOwnerLabel: "unsafe",
        proofRequiredBeforePromotion: "unsafe",
        reason: "unsafe",
        rawDiff: "not allowed",
      },
    ] as unknown as Issue131DeferredHandoffRow[];

    const validation = validateIssue131DeferredHandoffRows(unsafeRows);
    expect(validation.passed).toBe(false);
    expect(validation.reasons.join("\n")).toContain("Forbidden raw handoff fields detected");
    expect(validation.reasons.join("\n")).toContain("$[5].rawDiff");
  });
});
