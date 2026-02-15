import { describe, expect, test } from "bun:test";
import type { DepBumpContext } from "./dep-bump-detector.ts";
import { computeMergeConfidence } from "./merge-confidence.ts";
import type { MergeConfidence, MergeConfidenceLevel } from "./merge-confidence.ts";

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Builds a minimal valid DepBumpContext, allowing overrides */
function makeCtx(overrides: {
  bumpType?: "major" | "minor" | "patch" | "unknown";
  isBreaking?: boolean;
  security?: DepBumpContext["security"];
  changelog?: DepBumpContext["changelog"];
  isGroup?: boolean;
} = {}): DepBumpContext {
  return {
    detection: { source: "dependabot", signals: ["title", "branch"] },
    details: {
      packageName: "lodash",
      oldVersion: "4.17.20",
      newVersion: "4.17.21",
      ecosystem: "npm",
      isGroup: overrides.isGroup ?? false,
    },
    classification: {
      bumpType: overrides.bumpType ?? "patch",
      isBreaking: overrides.isBreaking ?? false,
    },
    security: "security" in overrides ? overrides.security : {
      advisories: [],
      isSecurityBump: false,
    },
    changelog: "changelog" in overrides ? overrides.changelog : {
      releaseNotes: [],
      breakingChanges: [],
      compareUrl: null,
      source: "releases",
    },
  };
}

// ─── Semver Signal Tests ─────────────────────────────────────────────────────

describe("computeMergeConfidence", () => {
  describe("semver signal", () => {
    test("patch + no advisories + no breaking → high with 3 rationale items", () => {
      const result = computeMergeConfidence(makeCtx({ bumpType: "patch" }));
      expect(result.level).toBe("high");
      expect(result.rationale).toContain("Patch version bump (bug fix only)");
      expect(result.rationale).toContain("No known security advisories");
      expect(result.rationale).toContain("No breaking changes detected in changelog");
      expect(result.rationale).toHaveLength(3);
    });

    test("minor + no advisories + no breaking → high", () => {
      const result = computeMergeConfidence(makeCtx({ bumpType: "minor" }));
      expect(result.level).toBe("high");
      expect(result.rationale).toContain("Minor version bump (backward-compatible)");
    });

    test("major + no advisories + no breaking → medium", () => {
      const result = computeMergeConfidence(makeCtx({ bumpType: "major" }));
      expect(result.level).toBe("medium");
      expect(result.rationale).toContain("Major version bump (potential breaking changes)");
    });

    test("unknown bump + no enrichment → medium", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "unknown",
        security: undefined,
        changelog: undefined,
      }));
      expect(result.level).toBe("medium");
      expect(result.rationale).toContain("Version change could not be classified");
    });
  });

  // ─── Advisory Signal Tests ───────────────────────────────────────────────────

  describe("advisory signal", () => {
    test("patch + critical advisory → low", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "patch",
        security: {
          advisories: [{
            ghsaId: "GHSA-1",
            cveId: null,
            severity: "critical",
            summary: "test",
            vulnerableVersionRange: "<4.17.21",
            firstPatchedVersion: "4.17.21",
            affectsOld: true,
            affectsNew: false,
            url: "https://github.com/advisories/GHSA-1",
          }],
          isSecurityBump: false,
        },
      }));
      expect(result.level).toBe("low");
      expect(result.rationale).toContain("critical-severity advisory affects this package");
    });

    test("patch + medium advisory → medium", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "patch",
        security: {
          advisories: [{
            ghsaId: "GHSA-1",
            cveId: null,
            severity: "medium",
            summary: "test",
            vulnerableVersionRange: "<4.17.21",
            firstPatchedVersion: "4.17.21",
            affectsOld: true,
            affectsNew: false,
            url: "https://github.com/advisories/GHSA-1",
          }],
          isSecurityBump: false,
        },
      }));
      expect(result.level).toBe("medium");
      expect(result.rationale).toContain("Security advisories exist for this package");
    });

    test("major + critical advisory → low", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "major",
        security: {
          advisories: [{
            ghsaId: "GHSA-1",
            cveId: null,
            severity: "high",
            summary: "test",
            vulnerableVersionRange: "<5.0.0",
            firstPatchedVersion: "5.0.0",
            affectsOld: true,
            affectsNew: false,
            url: "https://github.com/advisories/GHSA-1",
          }],
          isSecurityBump: false,
        },
      }));
      expect(result.level).toBe("low");
    });

    test("security-motivated bump with advisories → high (not downgraded)", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "patch",
        security: {
          advisories: [{
            ghsaId: "GHSA-1",
            cveId: null,
            severity: "critical",
            summary: "test",
            vulnerableVersionRange: "<4.17.21",
            firstPatchedVersion: "4.17.21",
            affectsOld: true,
            affectsNew: false,
            url: "https://github.com/advisories/GHSA-1",
          }],
          isSecurityBump: true,
        },
      }));
      expect(result.level).toBe("high");
      expect(result.rationale).toContain("Security-motivated bump (patches known vulnerability)");
    });

    test("security null (enrichment failed) → adds 'unavailable' rationale", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "patch",
        security: null,
      }));
      expect(result.level).toBe("high");
      expect(result.rationale).toContain("Security advisory data unavailable");
    });

    test("security undefined (group bump) → no security rationale added", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "patch",
        security: undefined,
        changelog: undefined,
      }));
      expect(result.level).toBe("high");
      expect(result.rationale.some(r => /security|advisory/i.test(r))).toBe(false);
      expect(result.rationale).toHaveLength(1); // only semver rationale
    });
  });

  // ─── Breaking Change Signal Tests ────────────────────────────────────────────

  describe("breaking change signal", () => {
    test("major + confirmed breaking changes → low", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "major",
        isBreaking: true,
        changelog: {
          releaseNotes: [{ tag: "v5.0.0", body: "BREAKING CHANGE: removed API" }],
          breakingChanges: ["BREAKING CHANGE: removed API"],
          compareUrl: null,
          source: "releases",
        },
      }));
      expect(result.level).toBe("low");
      expect(result.rationale).toContain("1 breaking change(s) detected in changelog");
    });

    test("minor + 2 breaking changes (isBreaking=false) → medium", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "minor",
        isBreaking: false,
        changelog: {
          releaseNotes: [],
          breakingChanges: ["change1", "change2"],
          compareUrl: null,
          source: "releases",
        },
      }));
      expect(result.level).toBe("medium");
      expect(result.rationale).toContain("2 breaking change(s) detected in changelog");
    });

    test("changelog with source 'compare-url-only' and no breaking → no 'No breaking changes' rationale", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "patch",
        changelog: {
          releaseNotes: [],
          breakingChanges: [],
          compareUrl: "https://github.com/lodash/lodash/compare/v4.17.20...v4.17.21",
          source: "compare-url-only",
        },
      }));
      expect(result.level).toBe("high");
      expect(result.rationale).not.toContain("No breaking changes detected in changelog");
    });

    test("changelog null → no changelog rationale", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "patch",
        changelog: null,
      }));
      expect(result.level).toBe("high");
      expect(result.rationale).not.toContain("No breaking changes detected in changelog");
    });

    test("changelog undefined → no changelog rationale", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "patch",
        changelog: undefined,
      }));
      expect(result.level).toBe("high");
      expect(result.rationale.some(r => /breaking/i.test(r))).toBe(false);
    });
  });

  // ─── Composite / Edge Case Tests ─────────────────────────────────────────────

  describe("composite scenarios", () => {
    test("group bump (isGroup=true, bumpType=unknown, no enrichment) → medium", () => {
      const result = computeMergeConfidence(makeCtx({
        bumpType: "unknown",
        isGroup: true,
        security: undefined,
        changelog: undefined,
      }));
      expect(result.level).toBe("medium");
      expect(result.rationale).toContain("Version change could not be classified");
    });
  });
});
