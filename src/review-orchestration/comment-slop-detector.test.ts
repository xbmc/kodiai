import { describe, expect, test } from "bun:test";
import { detectCommentSlopInDiff, toCommentSlopReducerFindings } from "./comment-slop-detector.ts";

describe("detectCommentSlopInDiff", () => {
  test("flags decorative banners that restate the following function", () => {
    const diff = `diff --git a/src/Cheevos.cpp b/src/Cheevos.cpp
index 1111111..2222222 100644
--- a/src/Cheevos.cpp
+++ b/src/Cheevos.cpp
@@ -20,3 +20,10 @@ void CCheevos::Start()
+// ===========================================================================
+// Destructor -- stop rich presence thread cleanly
+// ===========================================================================
+CCheevos::~CCheevos()
+{
+  StopRichPresenceThread();
+}
`;

    const findings = detectCommentSlopInDiff(diff);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      filePath: "src/Cheevos.cpp",
      line: 20,
      severity: "major",
      category: "maintainability",
      title: "Remove decorative comment banner",
    });
    expect(findings[0]?.body).toContain("restate");
  });

  test("flags obvious function header comments without separator lines", () => {
    const diff = `diff --git a/src/Foo.cpp b/src/Foo.cpp
index 1111111..2222222 100644
--- a/src/Foo.cpp
+++ b/src/Foo.cpp
@@ -41,2 +41,4 @@ namespace test
+// Constructor
+Foo::Foo() = default;
`;

    const findings = detectCommentSlopInDiff(diff);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      filePath: "src/Foo.cpp",
      line: 41,
      title: "Remove obvious code comment",
    });
  });

  test("keeps terse comments that explain non-obvious intent", () => {
    const diff = `diff --git a/src/wiki.ts b/src/wiki.ts
index 1111111..2222222 100644
--- a/src/wiki.ts
+++ b/src/wiki.ts
@@ -8,2 +8,4 @@ export function normalize(raw: RawPage): Page {
+// MediaWiki returns escaped HTML entities in titles, so decode before matching.
+const title = decode(raw.title);
`;

    expect(detectCommentSlopInDiff(diff)).toEqual([]);
  });

  test("maps findings into deterministic reducer findings", () => {
    const reducerFindings = toCommentSlopReducerFindings([
      {
        filePath: "src/Foo.cpp",
        line: 41,
        title: "Remove obvious code comment",
        body: "body",
        severity: "major",
        category: "maintainability",
        evidence: "// Constructor",
      },
    ]);

    expect(reducerFindings).toEqual([
      expect.objectContaining({
        commentId: -900000,
        filePath: "src/Foo.cpp",
        startLine: 41,
        endLine: 41,
        confidence: 95,
        deterministicFindingSource: "comment-slop-detector",
      }),
    ]);
  });
});
