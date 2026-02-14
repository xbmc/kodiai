import { describe, expect, test } from "bun:test";
import {
  detectDepBump,
  extractDepBumpDetails,
  classifyDepBump,
  parseSemver,
} from "./dep-bump-detector.ts";

// ─── Stage 1: detectDepBump ───────────────────────────────────────────────────

describe("detectDepBump", () => {
  test("detects Dependabot PR with title + branch + sender signals", () => {
    const result = detectDepBump({
      prTitle: "Bump lodash from 4.17.20 to 4.17.21",
      prLabels: [],
      headBranch: "dependabot/npm_and_yarn/lodash-4.17.21",
      senderLogin: "dependabot[bot]",
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("dependabot");
    expect(result!.signals).toContain("title");
    expect(result!.signals).toContain("branch");
    expect(result!.signals).toContain("sender");
  });

  test("detects Dependabot PR with conventional commit title format", () => {
    const result = detectDepBump({
      prTitle: "chore(deps): bump lodash from 4.17.20 to 4.17.21",
      prLabels: [],
      headBranch: "dependabot/npm_and_yarn/lodash-4.17.21",
      senderLogin: "dependabot[bot]",
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("dependabot");
    expect(result!.signals).toContain("title");
  });

  test("detects Renovate PR with title + label + branch + sender signals", () => {
    const result = detectDepBump({
      prTitle: "Update dependency typescript to v5.4.0",
      prLabels: ["renovate"],
      headBranch: "renovate/typescript-5.x",
      senderLogin: "renovate[bot]",
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("renovate");
    expect(result!.signals).toContain("title");
    expect(result!.signals).toContain("label");
    expect(result!.signals).toContain("branch");
    expect(result!.signals).toContain("sender");
  });

  test("returns null for human PR with bump-like title but no second signal", () => {
    const result = detectDepBump({
      prTitle: "Bump minimum Node version to 20",
      prLabels: [],
      headBranch: "feature/node-20",
      senderLogin: "someuser",
    });
    expect(result).toBeNull();
  });

  test("returns null for non-dependency PR (zero signals)", () => {
    const result = detectDepBump({
      prTitle: "Fix typo in readme",
      prLabels: [],
      headBranch: "main",
      senderLogin: "someuser",
    });
    expect(result).toBeNull();
  });

  test("detects group bump PR from Dependabot", () => {
    const result = detectDepBump({
      prTitle: "Bump the react group with 3 updates",
      prLabels: ["dependencies"],
      headBranch: "dependabot/npm_and_yarn/react-group",
      senderLogin: "dependabot[bot]",
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("dependabot");
  });

  test("detects PR with only sender + branch signals (no title match)", () => {
    const result = detectDepBump({
      prTitle: "Some custom title",
      prLabels: [],
      headBranch: "dependabot/npm_and_yarn/lodash-4.17.21",
      senderLogin: "dependabot[bot]",
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe("dependabot");
    expect(result!.signals).toContain("branch");
    expect(result!.signals).toContain("sender");
    expect(result!.signals).not.toContain("title");
  });

  test("detects PR with label + sender signals", () => {
    const result = detectDepBump({
      prTitle: "Some custom title",
      prLabels: ["dependencies"],
      headBranch: "some-branch",
      senderLogin: "dependabot[bot]",
    });
    expect(result).not.toBeNull();
    expect(result!.signals).toContain("label");
    expect(result!.signals).toContain("sender");
  });

  test("detects PR with security label as a signal", () => {
    const result = detectDepBump({
      prTitle: "Bump axios from 0.21.1 to 0.21.2",
      prLabels: ["security"],
      headBranch: "main",
      senderLogin: "someuser",
    });
    // title + label = 2 signals
    expect(result).not.toBeNull();
  });

  test("returns null for single label signal with no other signals", () => {
    const result = detectDepBump({
      prTitle: "Add new feature",
      prLabels: ["dependencies"],
      headBranch: "feature/add-stuff",
      senderLogin: "someuser",
    });
    expect(result).toBeNull();
  });
});

// ─── Stage 2: extractDepBumpDetails ───────────────────────────────────────────

describe("extractDepBumpDetails", () => {
  test("extracts Dependabot single package bump from title + branch", () => {
    const detection = { source: "dependabot" as const, signals: ["title", "branch", "sender"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Bump lodash from 4.17.20 to 4.17.21",
      prBody: null,
      changedFiles: [],
      headBranch: "dependabot/npm_and_yarn/lodash-4.17.21",
    });
    expect(result.packageName).toBe("lodash");
    expect(result.oldVersion).toBe("4.17.20");
    expect(result.newVersion).toBe("4.17.21");
    expect(result.ecosystem).toBe("npm");
    expect(result.isGroup).toBe(false);
  });

  test("extracts Renovate single package bump (no old version in title)", () => {
    const detection = { source: "renovate" as const, signals: ["title", "branch", "sender"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Update dependency typescript to v5.4.0",
      prBody: null,
      changedFiles: ["package.json"],
      headBranch: "renovate/typescript-5.x",
    });
    expect(result.packageName).toBe("typescript");
    expect(result.oldVersion).toBeNull();
    expect(result.newVersion).toBe("5.4.0");
    expect(result.ecosystem).toBe("npm");
    expect(result.isGroup).toBe(false);
  });

  test("extracts Renovate range title with from/to versions", () => {
    const detection = { source: "renovate" as const, signals: ["title", "sender"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Update dependency typescript from 5.3.0 to v5.4.0",
      prBody: null,
      changedFiles: ["package.json"],
      headBranch: "renovate/typescript-5.x",
    });
    expect(result.packageName).toBe("typescript");
    expect(result.oldVersion).toBe("5.3.0");
    expect(result.newVersion).toBe("5.4.0");
  });

  test("detects group bump and marks isGroup without per-package extraction", () => {
    const detection = { source: "dependabot" as const, signals: ["title", "branch", "sender"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Bump the react group with 3 updates",
      prBody: null,
      changedFiles: [],
      headBranch: "dependabot/npm_and_yarn/react-group",
    });
    expect(result.packageName).toBeNull();
    expect(result.oldVersion).toBeNull();
    expect(result.newVersion).toBeNull();
    expect(result.ecosystem).toBe("npm");
    expect(result.isGroup).toBe(true);
  });

  test("detects ecosystem from Dependabot pip branch", () => {
    const detection = { source: "dependabot" as const, signals: ["title", "branch"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Bump requests from 2.27.0 to 2.28.0",
      prBody: null,
      changedFiles: [],
      headBranch: "dependabot/pip/requests-2.28.0",
    });
    expect(result.ecosystem).toBe("python");
  });

  test("detects ecosystem from Dependabot go_modules branch", () => {
    const detection = { source: "dependabot" as const, signals: ["title", "branch"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Bump golang.org/x/net from 0.9.0 to 0.10.0",
      prBody: null,
      changedFiles: [],
      headBranch: "dependabot/go_modules/golang.org/x/net-0.10.0",
    });
    expect(result.ecosystem).toBe("go");
    expect(result.packageName).toBe("golang.org/x/net");
  });

  test("falls back to manifest file for ecosystem detection", () => {
    const detection = { source: "renovate" as const, signals: ["sender", "label"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Some custom title",
      prBody: null,
      changedFiles: ["go.mod", "go.sum"],
      headBranch: "renovate/some-package",
    });
    expect(result.ecosystem).toBe("go");
  });

  test("falls back to manifest file: Gemfile -> ruby", () => {
    const detection = { source: "renovate" as const, signals: ["sender", "label"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Update dependency nokogiri to v1.15.0",
      prBody: null,
      changedFiles: ["Gemfile", "Gemfile.lock"],
      headBranch: "renovate/nokogiri",
    });
    expect(result.ecosystem).toBe("ruby");
  });

  test("extracts conventional-commit formatted Dependabot title", () => {
    const detection = { source: "dependabot" as const, signals: ["title", "branch"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "chore(deps): bump lodash from 4.17.20 to 4.17.21",
      prBody: null,
      changedFiles: [],
      headBranch: "dependabot/npm_and_yarn/lodash-4.17.21",
    });
    expect(result.packageName).toBe("lodash");
    expect(result.oldVersion).toBe("4.17.20");
    expect(result.newVersion).toBe("4.17.21");
  });

  test("handles Renovate monorepo group title", () => {
    const detection = { source: "renovate" as const, signals: ["title", "sender"] };
    const result = extractDepBumpDetails({
      detection,
      prTitle: "Update react monorepo",
      prBody: null,
      changedFiles: ["package.json"],
      headBranch: "renovate/react-monorepo",
    });
    expect(result.isGroup).toBe(true);
    expect(result.ecosystem).toBe("npm");
  });

  test("detects ecosystem from various Dependabot branch segments", () => {
    const ecosystems: Array<[string, string]> = [
      ["dependabot/cargo/serde-1.0.163", "rust"],
      ["dependabot/composer/symfony-6.3.0", "php"],
      ["dependabot/maven/spring-boot-3.1.0", "java"],
      ["dependabot/gradle/kotlin-1.9.0", "java"],
      ["dependabot/nuget/newtonsoft-13.0.3", "dotnet"],
      ["dependabot/bundler/rails-7.0.5", "ruby"],
      ["dependabot/github_actions/actions/checkout-4", "github-actions"],
      ["dependabot/docker/node-20", "docker"],
      ["dependabot/terraform/aws-5.0.0", "terraform"],
    ];
    for (const [branch, expectedEcosystem] of ecosystems) {
      const detection = { source: "dependabot" as const, signals: ["branch", "sender"] };
      const result = extractDepBumpDetails({
        detection,
        prTitle: "Bump something",
        prBody: null,
        changedFiles: [],
        headBranch: branch,
      });
      expect(result.ecosystem).toBe(expectedEcosystem);
    }
  });

  test("detects ecosystem from various manifest files", () => {
    const manifests: Array<[string[], string]> = [
      [["package.json"], "npm"],
      [["package-lock.json"], "npm"],
      [["yarn.lock"], "npm"],
      [["pnpm-lock.yaml"], "npm"],
      [["Cargo.toml"], "rust"],
      [["requirements.txt"], "python"],
      [["Pipfile"], "python"],
      [["pyproject.toml"], "python"],
      [["pom.xml"], "java"],
      [["build.gradle"], "java"],
      [["composer.json"], "php"],
    ];
    for (const [files, expectedEcosystem] of manifests) {
      const detection = { source: "renovate" as const, signals: ["sender", "label"] };
      const result = extractDepBumpDetails({
        detection,
        prTitle: "Update something",
        prBody: null,
        changedFiles: files,
        headBranch: "renovate/something",
      });
      expect(result.ecosystem).toBe(expectedEcosystem);
    }
  });
});

// ─── Stage 3: parseSemver ─────────────────────────────────────────────────────

describe("parseSemver", () => {
  test("parses clean X.Y.Z version", () => {
    const result = parseSemver("1.2.3");
    expect(result).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  test("strips leading v prefix", () => {
    const result = parseSemver("v2.0.0");
    expect(result).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  test("strips leading V prefix (uppercase)", () => {
    const result = parseSemver("V2.0.0");
    expect(result).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  test("strips pre-release metadata", () => {
    const result = parseSemver("1.0.0-beta.1");
    expect(result).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  test("strips build metadata", () => {
    const result = parseSemver("1.0.0+build.123");
    expect(result).toEqual({ major: 1, minor: 0, patch: 0 });
  });

  test("handles two-part version (X.Y)", () => {
    const result = parseSemver("1.2");
    expect(result).toEqual({ major: 1, minor: 2, patch: 0 });
  });

  test("handles calver format", () => {
    const result = parseSemver("2024.01.15");
    expect(result).toEqual({ major: 2024, minor: 1, patch: 15 });
  });

  test("returns null for single number", () => {
    const result = parseSemver("42");
    expect(result).toBeNull();
  });

  test("returns null for non-numeric input", () => {
    const result = parseSemver("not-a-version");
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = parseSemver("");
    expect(result).toBeNull();
  });
});

// ─── Stage 3: classifyDepBump ─────────────────────────────────────────────────

describe("classifyDepBump", () => {
  test("classifies major bump as breaking", () => {
    const result = classifyDepBump({ oldVersion: "1.0.0", newVersion: "2.0.0" });
    expect(result.bumpType).toBe("major");
    expect(result.isBreaking).toBe(true);
  });

  test("classifies minor bump as non-breaking", () => {
    const result = classifyDepBump({ oldVersion: "1.0.0", newVersion: "1.1.0" });
    expect(result.bumpType).toBe("minor");
    expect(result.isBreaking).toBe(false);
  });

  test("classifies patch bump as non-breaking", () => {
    const result = classifyDepBump({ oldVersion: "1.0.0", newVersion: "1.0.1" });
    expect(result.bumpType).toBe("patch");
    expect(result.isBreaking).toBe(false);
  });

  test("handles v-prefix versions", () => {
    const result = classifyDepBump({ oldVersion: "v1.0.0", newVersion: "v2.0.0" });
    expect(result.bumpType).toBe("major");
    expect(result.isBreaking).toBe(true);
  });

  test("returns unknown for same base version with pre-release diff", () => {
    const result = classifyDepBump({ oldVersion: "1.0.0-beta.1", newVersion: "1.0.0" });
    expect(result.bumpType).toBe("unknown");
    expect(result.isBreaking).toBe(false);
  });

  test("returns unknown when oldVersion is null", () => {
    const result = classifyDepBump({ oldVersion: null, newVersion: "1.0.0" });
    expect(result.bumpType).toBe("unknown");
    expect(result.isBreaking).toBe(false);
  });

  test("returns unknown when newVersion is null", () => {
    const result = classifyDepBump({ oldVersion: "1.0.0", newVersion: null });
    expect(result.bumpType).toBe("unknown");
    expect(result.isBreaking).toBe(false);
  });

  test("returns unknown for unparseable oldVersion", () => {
    const result = classifyDepBump({ oldVersion: "not-a-version", newVersion: "1.0.0" });
    expect(result.bumpType).toBe("unknown");
    expect(result.isBreaking).toBe(false);
  });

  test("handles calver as semver comparison", () => {
    const result = classifyDepBump({ oldVersion: "2024.01.15", newVersion: "2024.02.01" });
    expect(result.bumpType).toBe("minor");
    expect(result.isBreaking).toBe(false);
  });

  test("handles both versions null", () => {
    const result = classifyDepBump({ oldVersion: null, newVersion: null });
    expect(result.bumpType).toBe("unknown");
    expect(result.isBreaking).toBe(false);
  });
});
