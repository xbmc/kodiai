import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "util";

const DEFAULT_DB_PATH = "./data/kodiai-knowledge.db";

function printUsage(): void {
  console.log(`Usage: bun scripts/kodiai-stats.ts --repo <owner/name> [options]

Options:
  --repo <owner/name>  Repository to query (required)
  --since <value>      Time filter: Nd (e.g. 7d) or ISO date (optional)
  --json               Output JSON instead of table
  --db <path>          Database path (default: ./data/kodiai-knowledge.db)
  -h, --help           Show this help

Examples:
  bun scripts/kodiai-stats.ts --repo acme/api
  bun scripts/kodiai-stats.ts --repo acme/api --since 30d
  bun scripts/kodiai-stats.ts --repo acme/api --json`);
}

function parseSince(value: string): string {
  const relMatch = value.match(/^(\d+)d$/);
  if (relMatch) {
    const days = Number.parseInt(relMatch[1]!, 10);
    return `-${days} days`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  }

  console.error(`Invalid --since value: ${value}. Use Nd (e.g. 30d) or ISO date.`);
  process.exit(1);
}

function padLeft(text: string, width: number): string {
  return text.padStart(width);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    repo: { type: "string" },
    since: { type: "string" },
    json: { type: "boolean", default: false },
    db: { type: "string", default: DEFAULT_DB_PATH },
    help: { type: "boolean", default: false, short: "h" },
  },
  strict: true,
});

if (values.help) {
  printUsage();
  process.exit(0);
}

if (!values.repo) {
  console.error("--repo is required");
  printUsage();
  process.exit(1);
}

const dbPath = resolve(values.db!);
if (!existsSync(dbPath)) {
  console.error(`No knowledge store found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
db.run("PRAGMA busy_timeout = 5000");

const sinceClause: string[] = [];
const params: Record<string, string | number> = { $repo: values.repo };

if (values.since) {
  const parsedSince = parseSince(values.since);
  if (parsedSince.startsWith("-")) {
    sinceClause.push("AND created_at >= datetime('now', $sinceModifier)");
    params.$sinceModifier = parsedSince;
  } else {
    sinceClause.push("AND created_at >= $sinceAbsolute");
    params.$sinceAbsolute = parsedSince;
  }
}

const reviewsSummary = db
  .query(`
    SELECT
      COUNT(*) AS total_reviews,
      COALESCE(SUM(findings_total), 0) AS total_findings,
      COALESCE(SUM(suppressions_applied), 0) AS total_suppressed
    FROM reviews
    WHERE repo = $repo
    ${sinceClause.join(" ")}
  `)
  .get(params) as { total_reviews: number; total_findings: number; total_suppressed: number };

if (reviewsSummary.total_reviews === 0) {
  console.log(`No reviews found for ${values.repo}`);
  db.close();
  process.exit(0);
}

const severityRows = db
  .query(`
    SELECT f.severity AS severity, COUNT(*) AS count
    FROM findings f
    INNER JOIN reviews r ON r.id = f.review_id
    WHERE r.repo = $repo
    ${sinceClause.join(" ").replace(/created_at/g, "r.created_at")}
    GROUP BY f.severity
  `)
  .all(params) as Array<{ severity: string; count: number }>;

const avgConfidence = db
  .query(`
    SELECT COALESCE(AVG(f.confidence), 0) AS avg_confidence
    FROM findings f
    INNER JOIN reviews r ON r.id = f.review_id
    WHERE r.repo = $repo
    ${sinceClause.join(" ").replace(/created_at/g, "r.created_at")}
  `)
  .get(params) as { avg_confidence: number };

const topFiles = db
  .query(`
    SELECT f.file_path AS path, COUNT(*) AS finding_count
    FROM findings f
    INNER JOIN reviews r ON r.id = f.review_id
    WHERE r.repo = $repo
    ${sinceClause.join(" ").replace(/created_at/g, "r.created_at")}
    GROUP BY f.file_path
    ORDER BY finding_count DESC, f.file_path ASC
    LIMIT 10
  `)
  .all(params) as Array<{ path: string; finding_count: number }>;

const severity = {
  critical: 0,
  major: 0,
  medium: 0,
  minor: 0,
};
for (const row of severityRows) {
  if (row.severity in severity) {
    severity[row.severity as keyof typeof severity] = row.count;
  }
}

const payload = {
  repo: values.repo,
  since: values.since ?? null,
  totalReviews: reviewsSummary.total_reviews,
  totalFindings: reviewsSummary.total_findings,
  totalSuppressed: reviewsSummary.total_suppressed,
  avgFindingsPerReview: reviewsSummary.total_findings / reviewsSummary.total_reviews,
  avgConfidence: Number(avgConfidence.avg_confidence ?? 0),
  severity,
  topFiles: topFiles.map((row) => ({ path: row.path, findingCount: row.finding_count })),
};

if (values.json) {
  console.log(JSON.stringify(payload, null, 2));
  db.close();
  process.exit(0);
}

console.log(`Kodiai Review Stats: ${payload.repo}`);
console.log("==========================================");
console.log(`Period:           ${values.since ? values.since : "All time"}`);
console.log(`Reviews:          ${payload.totalReviews}`);
console.log(`Total Findings:   ${payload.totalFindings} (${payload.totalSuppressed} suppressed)`);
console.log(`Avg Findings/PR:  ${payload.avgFindingsPerReview.toFixed(1)}`);
console.log(`Avg Confidence:   ${Math.round(payload.avgConfidence)}%`);

if (severityRows.length === 0) {
  console.log("\nNo finding details recorded yet");
  db.close();
  process.exit(0);
}

console.log("\nBy Severity:");
console.log(`  Critical:${padLeft(String(payload.severity.critical), 4)}`);
console.log(`  Major:   ${padLeft(String(payload.severity.major), 4)}`);
console.log(`  Medium:  ${padLeft(String(payload.severity.medium), 4)}`);
console.log(`  Minor:   ${padLeft(String(payload.severity.minor), 4)}`);

if (payload.topFiles.length === 0) {
  console.log("\nNo finding details recorded yet");
  db.close();
  process.exit(0);
}

console.log("\nTop Files:");
for (const file of payload.topFiles) {
  console.log(`  ${file.path.padEnd(24)} ${file.findingCount} findings`);
}

db.close();
