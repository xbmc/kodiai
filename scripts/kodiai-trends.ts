import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "util";

const DEFAULT_DB_PATH = "./data/kodiai-knowledge.db";

function printUsage(): void {
  console.log(`Usage: bun scripts/kodiai-trends.ts --repo <owner/name> [options]

Options:
  --repo <owner/name>  Repository to query (required)
  --days <number>      Number of days to include (default: 30)
  --json               Output JSON instead of table
  --db <path>          Database path (default: ./data/kodiai-knowledge.db)
  -h, --help           Show this help

Examples:
  bun scripts/kodiai-trends.ts --repo acme/api
  bun scripts/kodiai-trends.ts --repo acme/api --days 90
  bun scripts/kodiai-trends.ts --repo acme/api --json`);
}

function padLeft(text: string, width: number): string {
  return text.padStart(width);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    repo: { type: "string" },
    days: { type: "string", default: "30" },
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

const days = Number.parseInt(values.days!, 10);
if (!Number.isInteger(days) || days <= 0) {
  console.error("--days must be a positive integer");
  process.exit(1);
}

const dbPath = resolve(values.db!);
if (!existsSync(dbPath)) {
  console.error(`No knowledge store found at ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
db.run("PRAGMA busy_timeout = 5000");

const trendRows = db
  .query(`
    SELECT
      day_rollup.date AS date,
      day_rollup.review_count AS review_count,
      COALESCE(finding_rollup.findings_count, 0) AS findings_count,
      day_rollup.suppressions_count AS suppressions_count,
      COALESCE(finding_rollup.avg_confidence, 0) AS avg_confidence
    FROM (
      SELECT
        strftime('%Y-%m-%d', created_at) AS date,
        COUNT(*) AS review_count,
        COALESCE(SUM(suppressions_applied), 0) AS suppressions_count
      FROM reviews
      WHERE repo = $repo
        AND created_at >= datetime('now', $daysModifier)
      GROUP BY strftime('%Y-%m-%d', created_at)
    ) AS day_rollup
    LEFT JOIN (
      SELECT
        strftime('%Y-%m-%d', r.created_at) AS date,
        COUNT(f.id) AS findings_count,
        AVG(f.confidence) AS avg_confidence
      FROM reviews r
      LEFT JOIN findings f ON f.review_id = r.id
      WHERE r.repo = $repo
        AND r.created_at >= datetime('now', $daysModifier)
      GROUP BY strftime('%Y-%m-%d', r.created_at)
    ) AS finding_rollup ON finding_rollup.date = day_rollup.date
    ORDER BY day_rollup.date DESC
  `)
  .all({ $repo: values.repo, $daysModifier: `-${days} days` }) as Array<{
  date: string;
  review_count: number;
  findings_count: number;
  suppressions_count: number;
  avg_confidence: number;
}>;

if (trendRows.length === 0) {
  console.log(`No reviews found for ${values.repo} in the last ${days} days`);
  db.close();
  process.exit(0);
}

const payload = trendRows.map((row) => ({
  date: row.date,
  reviewCount: row.review_count,
  findingsCount: row.findings_count,
  suppressionsCount: row.suppressions_count,
  avgConfidence: Number(row.avg_confidence ?? 0),
}));

if (values.json) {
  console.log(JSON.stringify(payload, null, 2));
  db.close();
  process.exit(0);
}

console.log(`Kodiai Review Trends: ${values.repo} (last ${days} days)`);
console.log("==========================================");
console.log(
  "Date        " +
    padLeft("Reviews", 8) +
    padLeft("Findings", 10) +
    padLeft("Suppressed", 12) +
    padLeft("Avg Confidence", 16),
);

for (const row of payload) {
  console.log(
    row.date +
      padLeft(String(row.reviewCount), 8) +
      padLeft(String(row.findingsCount), 10) +
      padLeft(String(row.suppressionsCount), 12) +
      padLeft(`${Math.round(row.avgConfidence)}%`, 16),
  );
}

db.close();
