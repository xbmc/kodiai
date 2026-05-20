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
  if (testRun.exitCode !== 0) {
    console.error(testRun.stderr.toString());
  }
  return failed.length === 0 ? 0 : 1;
}

const exitCode = await main();
process.exit(exitCode);
