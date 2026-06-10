import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import { parseIssueReferences } from "../lib/issue-reference-parser.ts";

export type WikiPrEvidencePr = {
  number: number;
  title: string;
  body: string | null;
  author: string;
  mergedAt: Date;
};

export type WikiPrEvidenceMatch = {
  filePath: string;
  patch: string;
  pageId: number | null;
  pageTitle: string | null;
  score: number;
};

async function insertWikiPrEvidenceBatch(opts: {
  sql: Sql;
  pr: WikiPrEvidencePr;
  matches: WikiPrEvidenceMatch[];
  issueRefsJson: string;
}): Promise<void> {
  const { sql, pr, matches, issueRefsJson } = opts;
  await sql`
    INSERT INTO wiki_pr_evidence (
      pr_number, pr_title, pr_description, pr_author, merged_at,
      file_path, patch, issue_references,
      matched_page_id, matched_page_title, heuristic_score
    )
    SELECT
      ${pr.number}, ${pr.title}, ${pr.body}, ${pr.author}, ${pr.mergedAt},
      batch.file_path, batch.patch, ${issueRefsJson}::jsonb,
      batch.page_id, batch.page_title, batch.score
    FROM unnest(
      ${matches.map((match) => match.filePath)}::text[],
      ${matches.map((match) => match.patch)}::text[],
      ${matches.map((match) => match.pageId)}::integer[],
      ${matches.map((match) => match.pageTitle)}::text[],
      ${matches.map((match) => match.score)}::double precision[]
    ) AS batch(file_path, patch, page_id, page_title, score)
    ON CONFLICT (pr_number, file_path, matched_page_id) DO UPDATE SET
      patch = EXCLUDED.patch,
      heuristic_score = EXCLUDED.heuristic_score,
      issue_references = EXCLUDED.issue_references
  `;
}

async function insertWikiPrEvidenceRow(opts: {
  sql: Sql;
  pr: WikiPrEvidencePr;
  match: WikiPrEvidenceMatch;
  issueRefsJson: string;
}): Promise<void> {
  const { sql, pr, match, issueRefsJson } = opts;
  await sql`
    INSERT INTO wiki_pr_evidence (
      pr_number, pr_title, pr_description, pr_author, merged_at,
      file_path, patch, issue_references,
      matched_page_id, matched_page_title, heuristic_score
    ) VALUES (
      ${pr.number}, ${pr.title}, ${pr.body}, ${pr.author}, ${pr.mergedAt},
      ${match.filePath}, ${match.patch}, ${issueRefsJson}::jsonb,
      ${match.pageId}, ${match.pageTitle}, ${match.score}
    )
    ON CONFLICT (pr_number, file_path, matched_page_id) DO UPDATE SET
      patch = EXCLUDED.patch,
      heuristic_score = EXCLUDED.heuristic_score,
      issue_references = EXCLUDED.issue_references
  `;
}

export async function storeWikiPrEvidence(opts: {
  sql: Sql;
  pr: WikiPrEvidencePr;
  matches: WikiPrEvidenceMatch[];
  logger: Pick<Logger, "warn" | "error">;
}): Promise<number> {
  const { sql, pr, matches, logger } = opts;
  if (matches.length === 0) return 0;

  const refs = parseIssueReferences({
    prBody: pr.body ?? "",
    commitMessages: [],
  });
  const issueRefsJson = JSON.stringify(
    refs.map((ref) => ({
      issueNumber: ref.issueNumber,
      keyword: ref.keyword,
      crossRepo: ref.crossRepo,
    })),
  );

  try {
    await insertWikiPrEvidenceBatch({ sql, pr, matches, issueRefsJson });
    return matches.length;
  } catch (err) {
    logger.warn(
      { err, prNumber: pr.number, matchCount: matches.length },
      "Failed to store PR evidence batch; falling back to per-row writes",
    );
  }

  let stored = 0;
  for (const match of matches) {
    try {
      await insertWikiPrEvidenceRow({ sql, pr, match, issueRefsJson });
      stored++;
    } catch (err) {
      logger.error(
        { err, prNumber: pr.number, filePath: match.filePath, pageId: match.pageId },
        "Failed to store PR evidence row (non-fatal)",
      );
    }
  }
  return stored;
}
