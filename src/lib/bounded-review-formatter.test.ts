import { describe, expect, it } from "bun:test";
import {
  parseAndStructureBoundedFindings,
  formatBoundedFindingsAsStructuredComment,
} from "./bounded-review-formatter.ts";

describe("bounded-review-formatter", () => {
  it("parses CRITICAL and MAJOR findings as blocking", () => {
    const prose = `
[CRITICAL] SQL injection in query builder - lines 1303-1310
[MAJOR] Missing error handling on network call - src/api.ts:45
    `;
    const structured = parseAndStructureBoundedFindings(prose);
    expect(structured.blocking.length).toBe(2);
    expect(structured.blocking[0].title).toContain("SQL injection");
    expect(structured.blocking[1].location).toBe("src/api.ts:45");
  });

  it("formats structured findings as markdown sections", () => {
    const findings = {
      blocking: [
        {
          title: "Buffer overflow risk",
          description: "unbounded write without size check",
          location: "src/unsafe.cpp:42",
        },
      ],
      design: [
        {
          title: "Architecture pattern change",
          description: "switching from singleton to service injection",
        },
      ],
      minor: [] as any[],
      testing: [] as any[],
    };
    const output = formatBoundedFindingsAsStructuredComment(findings);
    expect(output).toContain("## Blocking (1 finding)");
    expect(output).toContain("## Design Concern (1 finding)");
    expect(output).toContain("Buffer overflow risk");
    expect(output).toContain("Architecture pattern change");
  });

  it("handles mixed severity levels", () => {
    const prose = `
[CRITICAL] Security issue - bad-file.ts:10
[MAJOR] Performance degradation - slow-query.sql:5
[MEDIUM] Style inconsistency - format.ts:20
[MINOR] Unused import - utils.ts:3
    `;
    const structured = parseAndStructureBoundedFindings(prose);
    expect(structured.blocking.length).toBe(2); // CRITICAL + MAJOR
    expect(structured.minor.length).toBeGreaterThanOrEqual(2); // MINOR + MEDIUM
  });

  it("handles empty findings gracefully", () => {
    const output = formatBoundedFindingsAsStructuredComment({
      blocking: [],
      design: [],
      minor: [],
      testing: [],
    });
    expect(output).toBe("");
  });

  it("extracts file:line locations from prose", () => {
    const prose = "[MAJOR] Issue here - DVDDemuxFFmpeg.cpp:1303-1310";
    const structured = parseAndStructureBoundedFindings(prose);
    expect(structured.blocking[0].location).toBe("DVDDemuxFFmpeg.cpp:1303-1310");
  });
});
