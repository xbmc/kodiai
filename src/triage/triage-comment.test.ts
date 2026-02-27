import { describe, it, expect } from "bun:test";
import {
  formatTriageComment,
  buildTriageMarker,
  TRIAGE_MARKER_PREFIX,
} from "./triage-comment.ts";
import type { DuplicateCandidate } from "./duplicate-detector.ts";

describe("buildTriageMarker", () => {
  it("produces correct HTML comment format", () => {
    const marker = buildTriageMarker("owner/repo", 42);
    expect(marker).toBe("<!-- kodiai:triage:owner/repo:42 -->");
  });
});

describe("formatTriageComment", () => {
  const marker = "<!-- kodiai:triage:owner/repo:100 -->";

  it("formats table with mixed open/closed candidates, closed sorted first", () => {
    const candidates: DuplicateCandidate[] = [
      { issueNumber: 10, title: "Open issue", state: "open", similarityPct: 90 },
      { issueNumber: 20, title: "Closed issue", state: "closed", similarityPct: 85 },
      { issueNumber: 30, title: "Another open", state: "open", similarityPct: 80 },
    ];

    const result = formatTriageComment(candidates, marker);
    const lines = result.split("\n");

    // Closed should come first in the table body
    expect(lines[4]).toContain("#20");
    expect(lines[4]).toContain("closed");

    // Then open issues sorted by similarity desc
    expect(lines[5]).toContain("#10");
    expect(lines[5]).toContain("90%");
    expect(lines[6]).toContain("#30");
    expect(lines[6]).toContain("80%");
  });

  it("appends 'all closed' note when all candidates are closed", () => {
    const candidates: DuplicateCandidate[] = [
      { issueNumber: 10, title: "Closed A", state: "closed", similarityPct: 90 },
      { issueNumber: 20, title: "Closed B", state: "closed", similarityPct: 85 },
    ];

    const result = formatTriageComment(candidates, marker);
    expect(result).toContain("All matches are closed issues -- the problem may already be resolved.");
  });

  it("does not append note when mix of open and closed", () => {
    const candidates: DuplicateCandidate[] = [
      { issueNumber: 10, title: "Open issue", state: "open", similarityPct: 90 },
      { issueNumber: 20, title: "Closed issue", state: "closed", similarityPct: 85 },
    ];

    const result = formatTriageComment(candidates, marker);
    expect(result).not.toContain("All matches are closed issues");
  });

  it("includes marker in output", () => {
    const candidates: DuplicateCandidate[] = [
      { issueNumber: 10, title: "Issue", state: "open", similarityPct: 90 },
    ];

    const result = formatTriageComment(candidates, marker);
    expect(result).toContain(marker);
  });

  it("includes header line", () => {
    const candidates: DuplicateCandidate[] = [
      { issueNumber: 10, title: "Issue", state: "open", similarityPct: 90 },
    ];

    const result = formatTriageComment(candidates, marker);
    expect(result).toContain("Possible duplicates detected:");
  });

  it("includes table headers", () => {
    const candidates: DuplicateCandidate[] = [
      { issueNumber: 10, title: "Issue", state: "open", similarityPct: 90 },
    ];

    const result = formatTriageComment(candidates, marker);
    expect(result).toContain("| Issue | Title | Similarity | Status |");
  });
});

describe("TRIAGE_MARKER_PREFIX", () => {
  it("has the expected value", () => {
    expect(TRIAGE_MARKER_PREFIX).toBe("kodiai:triage");
  });
});
