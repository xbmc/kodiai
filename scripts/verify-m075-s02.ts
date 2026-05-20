type CheckResult = {
  id: string;
  status: "pass" | "fail";
  message: string;
};

const EXPECTED_PACKAGE_SCRIPT = "bun scripts/verify-m075-s02.ts";

async function main(): Promise<number> {
  const checks: CheckResult[] = [];

  const packageJson = JSON.parse(await Bun.file("package.json").text()) as {
    scripts?: Record<string, string>;
  };
  checks.push({
    id: "package-wiring.present",
    status: packageJson.scripts?.["verify:m075:s02"] === EXPECTED_PACKAGE_SCRIPT ? "pass" : "fail",
    message: "package.json exposes verify:m075:s02",
  });

  const memoryStoreSource = await Bun.file("src/knowledge/memory-store.ts").text();
  const reviewHelperSource = await Bun.file("src/handlers/review-learning-memory.ts").text();
  const reviewHandlerSource = await Bun.file("src/handlers/review.ts").text();
  checks.push({
    id: "memory-store.prepare-helper.exported",
    status: memoryStoreSource.includes("export function prepareLearningMemoryRecordForSql") ? "pass" : "fail",
    message: "memory-store exports the SQL preparation helper",
  });
  checks.push({
    id: "memory-store.write-boundary.used",
    status: memoryStoreSource.includes("const preparedRecord = prepareLearningMemoryRecordForSql(record)") ? "pass" : "fail",
    message: "writeMemory prepares records before SQL interpolation",
  });

  checks.push({
    id: "review-learning-memory.helper.exported",
    status: reviewHelperSource.includes("export function buildReviewLearningMemoryRecord") ? "pass" : "fail",
    message: "review learning-memory helper exports the record-building decision",
  });
  checks.push({
    id: "review-learning-memory.skip-reasons.bounded",
    status: ["missing-finding-id", "missing-review-id", "invalid-embedding-metadata"].every((reason) => reviewHelperSource.includes(reason)) ? "pass" : "fail",
    message: "review learning-memory helper has bounded skip reasons for invalid persistence inputs",
  });
  checks.push({
    id: "review-handler.skip-before-embedding",
    status: reviewHandlerSource.indexOf("buildReviewLearningMemoryRecord") >= 0
      && reviewHandlerSource.indexOf("buildReviewLearningMemoryRecord") < reviewHandlerSource.indexOf("embeddingProvider.generate(decision.embeddingText"),
    message: "review handler makes the learning-memory skip decision before embedding generation",
  });

  const helperTestRun = Bun.spawnSync({
    cmd: ["bun", "test", "src/handlers/review-learning-memory.test.ts"],
    env: { ...process.env, TEST_DATABASE_URL: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  checks.push({
    id: "review-learning-memory.tests.pass",
    status: helperTestRun.exitCode === 0 ? "pass" : "fail",
    message: "review learning-memory skip/record tests pass",
  });

  const testRun = Bun.spawnSync({
    cmd: ["bun", "test", "src/knowledge/memory-store.test.ts"],
    env: { ...process.env, TEST_DATABASE_URL: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  checks.push({
    id: "memory-store.tests.pass",
    status: testRun.exitCode === 0 ? "pass" : "fail",
    message: "memory-store undefined SQL hardening tests pass",
  });

  const failed = checks.filter((check) => check.status === "fail");
  const report = {
    command: "verify:m075:s02",
    success: failed.length === 0,
    checks,
    failedCheckIds: failed.map((check) => check.id),
  };

  console.log(JSON.stringify(report, null, 2));
  if (helperTestRun.exitCode !== 0) {
    console.error(helperTestRun.stderr.toString());
  }
  if (testRun.exitCode !== 0) {
    console.error(testRun.stderr.toString());
  }
  return failed.length === 0 ? 0 : 1;
}

const exitCode = await main();
process.exit(exitCode);
