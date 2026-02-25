import { describe, expect, test } from "bun:test";
import {
  detectDependsBump,
  type DependsBumpInfo,
} from "./depends-bump-detector";

describe("detectDependsBump", () => {
  // ─── Positive matches (real xbmc/xbmc PR titles) ─────────────────────────

  describe("positive matches", () => {
    test("[depends] Bump zlib 1.3.2", () => {
      const result = detectDependsBump("[depends] Bump zlib 1.3.2");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("zlib");
      expect(result!.packages[0]!.newVersion).toBe("1.3.2");
    });

    test("[depends] Bump TagLib to 2.2", () => {
      const result = detectDependsBump("[depends] Bump TagLib to 2.2");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("TagLib");
      expect(result!.packages[0]!.newVersion).toBe("2.2");
    });

    test("[depends][target] Bump libcdio to 2.3.0 -- nested brackets", () => {
      const result = detectDependsBump("[depends][target] Bump libcdio to 2.3.0");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("libcdio");
      expect(result!.packages[0]!.newVersion).toBe("2.3.0");
    });

    test("[depends] Bump openssl to 3.0.19 / python3 to 3.14.3 -- multi-package", () => {
      const result = detectDependsBump(
        "[depends] Bump openssl to 3.0.19 / python3 to 3.14.3",
      );
      expect(result).not.toBeNull();
      expect(result!.packages).toHaveLength(2);
      expect(result!.packages[0]!.name).toBe("openssl");
      expect(result!.packages[0]!.newVersion).toBe("3.0.19");
      expect(result!.packages[1]!.name).toBe("python3");
      expect(result!.packages[1]!.newVersion).toBe("3.14.3");
    });

    test("[Depends] Bump mariadb-c-connector 3.4.8 -- capitalized", () => {
      const result = detectDependsBump("[Depends] Bump mariadb-c-connector 3.4.8");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("mariadb-c-connector");
      expect(result!.packages[0]!.newVersion).toBe("3.4.8");
    });

    test("[Windows] Refresh fstrcmp 0.7 -- Windows platform, Refresh verb", () => {
      const result = detectDependsBump("[Windows] Refresh fstrcmp 0.7");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("fstrcmp");
      expect(result!.packages[0]!.newVersion).toBe("0.7");
      expect(result!.platform).toBe("windows");
    });

    test("[Windows] Bump libaacs to 0.11.1 -- Windows + Bump", () => {
      const result = detectDependsBump("[Windows] Bump libaacs to 0.11.1");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("libaacs");
      expect(result!.packages[0]!.newVersion).toBe("0.11.1");
      expect(result!.platform).toBe("windows");
    });

    test("[Windows] Bump Detours to 9764ceb -- commit hash version", () => {
      const result = detectDependsBump("[Windows] Bump Detours to 9764ceb");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("Detours");
      expect(result!.packages[0]!.newVersion).toBe("9764ceb");
    });

    test("[Windows] Bump Python to 3.14.3 / OpenSSL to 3.0.19 -- Windows multi-package", () => {
      const result = detectDependsBump(
        "[Windows] Bump Python to 3.14.3 / OpenSSL to 3.0.19",
      );
      expect(result).not.toBeNull();
      expect(result!.packages).toHaveLength(2);
      expect(result!.packages[0]!.name).toBe("Python");
      expect(result!.packages[0]!.newVersion).toBe("3.14.3");
      expect(result!.packages[1]!.name).toBe("OpenSSL");
      expect(result!.packages[1]!.newVersion).toBe("3.0.19");
      expect(result!.platform).toBe("windows");
    });

    test("[depends][target] Bump font libraries -- group bump (no version)", () => {
      const result = detectDependsBump("[depends][target] Bump font libraries");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("font libraries");
      expect(result!.packages[0]!.newVersion).toBeNull();
      expect(result!.isGroup).toBe(true);
    });

    test("[Depends] Update Harfbuzz to v12.3.0 -- Update verb, v-prefix", () => {
      const result = detectDependsBump("[Depends] Update Harfbuzz to v12.3.0");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("Harfbuzz");
      expect(result!.packages[0]!.newVersion).toBe("12.3.0");
    });

    test("[Windows] Bump dnssd to 2881.60.4 -- unusual version format", () => {
      const result = detectDependsBump("[Windows] Bump dnssd to 2881.60.4");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("dnssd");
      expect(result!.packages[0]!.newVersion).toBe("2881.60.4");
    });

    test("[android] Bump curl to 8.5.0 -- android platform", () => {
      const result = detectDependsBump("[android] Bump curl to 8.5.0");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("curl");
      expect(result!.packages[0]!.newVersion).toBe("8.5.0");
      expect(result!.platform).toBe("android");
    });

    test("[ios] Update ffmpeg to 6.1 -- iOS platform", () => {
      const result = detectDependsBump("[ios] Update ffmpeg to 6.1");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("ffmpeg");
      expect(result!.packages[0]!.newVersion).toBe("6.1");
      expect(result!.platform).toBe("ios");
    });

    test("[osx] Refresh libpng 1.6.40 -- macOS platform", () => {
      const result = detectDependsBump("[osx] Refresh libpng 1.6.40");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("libpng");
      expect(result!.packages[0]!.newVersion).toBe("1.6.40");
      expect(result!.platform).toBe("osx");
    });

    test("[linux] Bump gnutls to 3.8.3 -- Linux platform", () => {
      const result = detectDependsBump("[linux] Bump gnutls to 3.8.3");
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("gnutls");
      expect(result!.packages[0]!.newVersion).toBe("3.8.3");
      expect(result!.platform).toBe("linux");
    });

    test("target/depends: Update libxkbcommon to v1.13.1 -- target/depends prefix", () => {
      const result = detectDependsBump(
        "target/depends: Update libxkbcommon to v1.13.1",
      );
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.name).toBe("libxkbcommon");
      expect(result!.packages[0]!.newVersion).toBe("1.13.1");
    });
  });

  // ─── Negative matches ────────────────────────────────────────────────────

  describe("negative matches", () => {
    test("Dependabot: Bump lodash from 4.17.20 to 4.17.21", () => {
      const result = detectDependsBump(
        "Bump lodash from 4.17.20 to 4.17.21",
      );
      expect(result).toBeNull();
    });

    test("Renovate: Update dependency @types/node to v20", () => {
      const result = detectDependsBump("Update dependency @types/node to v20");
      expect(result).toBeNull();
    });

    test("Renovate chore: chore(deps): bump axios from 1.6.0 to 1.6.2", () => {
      const result = detectDependsBump(
        "chore(deps): bump axios from 1.6.0 to 1.6.2",
      );
      expect(result).toBeNull();
    });

    test("Regular PR: Fix memory leak in video player", () => {
      const result = detectDependsBump("Fix memory leak in video player");
      expect(result).toBeNull();
    });

    test("Non-depends bracket: [Feature] Add new codec support", () => {
      const result = detectDependsBump("[Feature] Add new codec support");
      expect(result).toBeNull();
    });

    test("Contains depends but not a bump: Depends on upstream fix for #1234", () => {
      const result = detectDependsBump("Depends on upstream fix for #1234");
      expect(result).toBeNull();
    });
  });

  // ─── Extraction tests ────────────────────────────────────────────────────

  describe("extraction", () => {
    test("extracts single package with version", () => {
      const result = detectDependsBump("[depends] Bump zlib 1.3.2");
      expect(result).not.toBeNull();
      expect(result!.packages).toEqual([
        { name: "zlib", newVersion: "1.3.2", oldVersion: null },
      ]);
    });

    test("extracts multi-package with versions", () => {
      const result = detectDependsBump(
        "[depends] Bump openssl to 3.0.19 / python3 to 3.14.3",
      );
      expect(result).not.toBeNull();
      expect(result!.packages).toEqual([
        { name: "openssl", newVersion: "3.0.19", oldVersion: null },
        { name: "python3", newVersion: "3.14.3", oldVersion: null },
      ]);
    });

    test("extracts group bump with null version", () => {
      const result = detectDependsBump("[depends][target] Bump font libraries");
      expect(result).not.toBeNull();
      expect(result!.packages).toEqual([
        { name: "font libraries", newVersion: null, oldVersion: null },
      ]);
      expect(result!.isGroup).toBe(true);
    });

    test("extracts platform from bracket prefix", () => {
      const result = detectDependsBump("[Windows] Refresh fstrcmp 0.7");
      expect(result).not.toBeNull();
      expect(result!.platform).toBe("windows");
    });

    test("strips v-prefix from version", () => {
      const result = detectDependsBump(
        "target/depends: Update libxkbcommon to v1.13.1",
      );
      expect(result).not.toBeNull();
      expect(result!.packages[0]!.newVersion).toBe("1.13.1");
    });

    test("platform is null for generic [depends]", () => {
      const result = detectDependsBump("[depends] Bump zlib 1.3.2");
      expect(result).not.toBeNull();
      expect(result!.platform).toBeNull();
    });

    test("rawTitle is preserved", () => {
      const title = "[depends] Bump zlib 1.3.2";
      const result = detectDependsBump(title);
      expect(result).not.toBeNull();
      expect(result!.rawTitle).toBe(title);
    });
  });
});
