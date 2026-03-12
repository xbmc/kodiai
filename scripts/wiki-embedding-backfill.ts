import { main as runWikiEmbeddingRepairMain, parseWikiEmbeddingRepairCliArgs } from "./wiki-embedding-repair.ts";
import { TARGET_WIKI_EMBEDDING_MODEL } from "../src/knowledge/wiki-embedding-repair.ts";

function usage(): string {
  return [
    "Usage: bun scripts/wiki-embedding-backfill.ts [--page-title <title>] [--resume] [--status] [--json]",
    "",
    "Compatibility wrapper:",
    "  This legacy entrypoint now delegates to bun run repair:wiki-embeddings.",
    "  The old monolithic backfill flow has been removed to keep wiki repair bounded and resumable.",
    "",
    "Accepted options:",
    "  --page-title <title>  Limit repair work to one wiki page title",
    "  --resume              Resume from persisted checkpoint state",
    "  --status              Read repair status without running repair work",
    "  --json                Print machine-readable JSON output",
    "  --help                Show this help",
    "",
    "Rejected legacy options:",
    `  --model <name>        Only ${TARGET_WIKI_EMBEDDING_MODEL} is supported`,
    "  --delay <ms>          Removed; bounded windows replace page-level throttling",
    "  --dry-run             Removed; use --status for non-mutating inspection",
  ].join("\n");
}

function readStringFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function validateLegacyArgs(args: string[]): string | null {
  const model = readStringFlag(args, "--model");
  if (model && model !== TARGET_WIKI_EMBEDDING_MODEL) {
    return `Legacy wiki repair wrapper refuses --model ${model}. Use the bounded repair CLI with ${TARGET_WIKI_EMBEDDING_MODEL}.`;
  }
  if (args.includes("--delay")) {
    return "Legacy wiki repair wrapper no longer supports --delay. The bounded repair CLI controls window sizing instead of page-level delays.";
  }
  if (args.includes("--dry-run")) {
    return "Legacy wiki repair wrapper no longer supports --dry-run. Use --status for a non-mutating checkpoint/status read.";
  }
  return null;
}

export async function main(
  args: string[] = process.argv.slice(2),
  deps?: {
    stdout?: { write: (chunk: string) => void };
    stderr?: { write: (chunk: string) => void };
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  const stderr = deps?.stderr ?? process.stderr;

  if (args.includes("--help") || args.includes("-h")) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const validationError = validateLegacyArgs(args);
  if (validationError) {
    stderr.write(`${validationError}\n`);
    return 1;
  }

  const options = parseWikiEmbeddingRepairCliArgs(args);
  const forwardedArgs: string[] = [];

  if (options.pageTitle) {
    forwardedArgs.push("--page-title", options.pageTitle);
  }
  if (options.resume) {
    forwardedArgs.push("--resume");
  }
  if (options.status) {
    forwardedArgs.push("--status");
  }
  if (options.json) {
    forwardedArgs.push("--json");
  }

  return await runWikiEmbeddingRepairMain(forwardedArgs, { stdout, stderr });
}

if (import.meta.main) {
  const exitCode = await main();
  process.exit(exitCode);
}
