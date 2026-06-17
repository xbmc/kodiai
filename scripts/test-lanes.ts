import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type TestLane = "unit" | "db";

export type TestLanePlan = {
  unit: string[];
  db: string[];
};

const DEFAULT_ROOTS = ["scripts", "src"] as const;
const DB_TEST_MARKER = /\b(?:process|Bun)\.env\.TEST_DATABASE_URL\b/;

export function classifyTestFile(content: string): TestLane {
  return DB_TEST_MARKER.test(content) ? "db" : "unit";
}

export async function discoverTestFiles(
  roots: readonly string[] = DEFAULT_ROOTS,
  cwd = process.cwd(),
): Promise<string[]> {
  const files: string[] = [];

  async function visit(relativePath: string): Promise<void> {
    const absolutePath = path.resolve(cwd, relativePath);
    const info = await stat(absolutePath);
    if (info.isDirectory()) {
      const entries = await readdir(absolutePath);
      for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
        await visit(path.join(relativePath, entry));
      }
      return;
    }

    if (info.isFile() && relativePath.endsWith(".test.ts")) {
      files.push(relativePath.split(path.sep).join("/"));
    }
  }

  for (const root of roots) {
    await visit(root);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

export async function buildTestLanePlan(options: {
  roots?: readonly string[];
  cwd?: string;
  readTextFile?: (filePath: string) => Promise<string>;
} = {}): Promise<TestLanePlan> {
  const cwd = options.cwd ?? process.cwd();
  const readTextFile = options.readTextFile ?? ((filePath: string) => readFile(path.resolve(cwd, filePath), "utf8"));
  const plan: TestLanePlan = { unit: [], db: [] };

  for (const filePath of await discoverTestFiles(options.roots, cwd)) {
    plan[classifyTestFile(await readTextFile(filePath))].push(filePath);
  }

  return plan;
}

export function parseTestLaneArgs(args: readonly string[]): {
  lane: TestLane;
  listOnly: boolean;
  roots: string[];
} {
  let lane: TestLane | undefined;
  let listOnly = false;
  const roots: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "unit" || arg === "db") {
      if (lane) throw new Error("invalid_cli_args: test lane specified more than once");
      lane = arg;
      continue;
    }
    if (arg === "--list") {
      listOnly = true;
      continue;
    }
    if (arg === "--root") {
      const root = args[index + 1];
      if (!root) throw new Error("invalid_cli_args: --root requires a path");
      roots.push(root);
      index += 1;
      continue;
    }
    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  if (!lane) throw new Error("invalid_cli_args: expected lane 'unit' or 'db'");
  return { lane, listOnly, roots };
}

async function run(): Promise<number> {
  const args = parseTestLaneArgs(process.argv.slice(2));
  const plan = await buildTestLanePlan({
    roots: args.roots.length > 0 ? args.roots : DEFAULT_ROOTS,
  });
  const files = plan[args.lane];

  if (args.listOnly) {
    process.stdout.write(`${files.join("\n")}${files.length > 0 ? "\n" : ""}`);
    return 0;
  }

  if (files.length === 0) {
    process.stdout.write(`No ${args.lane} tests discovered.\n`);
    return 0;
  }

  const command = args.lane === "db"
    ? ["bun", "test", "--max-concurrency=1", ...files]
    : ["bun", "test", ...files];
  const child = Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return await child.exited;
}

if (import.meta.main) {
  try {
    process.exit(await run());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`test-lanes failed: ${message}\n`);
    process.exit(1);
  }
}
