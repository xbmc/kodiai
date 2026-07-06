import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  findDirectGitHubPublicationWrites,
  findDirectOutgoingPublicationSanitizerUsage,
} from "./github-publication-architecture.ts";

describe("GitHub publication architecture", () => {
  test("detects direct body-bearing GitHub publication writes outside the facade", () => {
    const findings = findDirectGitHubPublicationWrites({
      files: {
        "src/handlers/unsafe.ts": "await octokit.rest.issues.createComment({ owner, repo, issue_number, body });",
        "src/handlers/unsafe-pr.ts": "await octokit.rest.pulls.create({ owner, repo, title, head, base, body });",
        "src/handlers/unsafe-destructured.ts": `
          const { createComment } = octokit.rest.issues;
          await createComment({ owner, repo, issue_number, body });
        `,
        "src/handlers/unsafe-aliased.ts": `
          const createReview = octokit.rest.pulls.createReview;
          await createReview({ owner, repo, pull_number, body, event: "COMMENT" });
        `,
        "src/handlers/unsafe-payload-alias.ts": `
          const payload = { owner, repo, issue_number, body };
          await octokit.rest.issues.createComment(payload);
        `,
        "src/handlers/unsafe-typed-payload-alias.ts": `
          const payload: { owner: string; repo: string; issue_number: number; body: string } = {
            owner,
            repo,
            issue_number,
            body,
          };
          await octokit.rest.issues.updateComment(payload);
        `,
        "src/handlers/unsafe-method-and-payload-alias.ts": `
          const reply = octokit.rest.pulls.createReplyForReviewComment;
          const payload = { owner, repo, pull_number, comment_id, body };
          await reply(payload);
        `,
        "src/handlers/unsafe-bracket-method.ts": `
          await octokit.rest.issues["createComment"]({ owner, repo, issue_number, body });
        `,
        "src/handlers/unsafe-bracket-namespace.ts": `
          await octokit.rest["pulls"].createReview({ owner, repo, pull_number, body, event: "COMMENT" });
        `,
        "src/handlers/unsafe-bracket-alias.ts": `
          const create = octokit.rest["issues"]["create"];
          await create({ owner, repo, title, body });
        `,
        "src/handlers/unsafe-request.ts": `await octokit.request(
          "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
          { owner, repo, pull_number, review_id, body },
        );`,
        "src/handlers/unsafe-request-template.ts": "await octokit.request(`PATCH /repos/{owner}/{repo}/issues/{issue_number}`, { owner, repo, issue_number, body });",
        "src/lib/github-publication.ts": "await octokit.rest.issues.createComment({ owner, repo, issue_number, body });",
        "src/handlers/safe.ts": "await createIssueCommentWithPublicationPipeline(octokit, { owner, repo, issue_number, body });",
      },
    });

    expect(findings).toEqual([
      {
        file: "src/handlers/unsafe-aliased.ts",
        method: "pulls.createReview",
      },
      {
        file: "src/handlers/unsafe-bracket-alias.ts",
        method: "issues.create",
      },
      {
        file: "src/handlers/unsafe-bracket-method.ts",
        method: "issues.createComment",
      },
      {
        file: "src/handlers/unsafe-bracket-namespace.ts",
        method: "pulls.createReview",
      },
      {
        file: "src/handlers/unsafe-destructured.ts",
        method: "issues.createComment",
      },
      {
        file: "src/handlers/unsafe-method-and-payload-alias.ts",
        method: "pulls.createReplyForReviewComment",
      },
      {
        file: "src/handlers/unsafe-payload-alias.ts",
        method: "issues.createComment",
      },
      {
        file: "src/handlers/unsafe-pr.ts",
        method: "pulls.create",
      },
      {
        file: "src/handlers/unsafe-request-template.ts",
        method: "request:PATCH /repos/{owner}/{repo}/issues/{issue_number}",
      },
      {
        file: "src/handlers/unsafe-request.ts",
        method: "request:PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
      },
      {
        file: "src/handlers/unsafe-typed-payload-alias.ts",
        method: "issues.updateComment",
      },
      {
        file: "src/handlers/unsafe.ts",
        method: "issues.createComment",
      },
    ]);
  });

  test("keeps production body-bearing GitHub publication writes behind the facade", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const files: Record<string, string> = {};

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        files[relative(repoRoot, path)] = readFileSync(path, "utf8");
      }
    }

    scan(join(repoRoot, "src"));

    expect(findDirectGitHubPublicationWrites({ files })).toEqual([]);
  });

  test("detects direct outbound sanitizer usage outside the GitHub publication facade", () => {
    const findings = findDirectOutgoingPublicationSanitizerUsage({
      files: {
        "src/handlers/unsafe.ts": "sanitizeOutgoingMentions(body, ['kodiai']);",
        "src/handlers/also-unsafe.ts": "prepareOutgoingBodyForPublication(body, ['kodiai']);",
        "src/handlers/unsafe-import-alias.ts": `
          import { sanitizeOutgoingMentions as sanitize } from "../lib/sanitizer.ts";
          sanitize(body, ["kodiai"]);
        `,
        "src/handlers/unsafe-assignment-alias.ts": `
          const prepare = prepareOutgoingBodyForPublication;
          prepare(body, ["kodiai"]);
        `,
        "src/lib/github-publication.ts": "prepareOutgoingBodyForPublication(body, ['kodiai']);",
        "src/lib/sanitizer.ts": "export function sanitizeOutgoingMentions(body: string) { return body; }",
        "src/handlers/safe.ts": "prepareGitHubPublication(body, { botHandles });",
      },
    });

    expect(findings).toEqual([
      {
        file: "src/handlers/also-unsafe.ts",
        symbol: "prepareOutgoingBodyForPublication",
      },
      {
        file: "src/handlers/unsafe-assignment-alias.ts",
        symbol: "prepareOutgoingBodyForPublication",
      },
      {
        file: "src/handlers/unsafe-import-alias.ts",
        symbol: "sanitizeOutgoingMentions",
      },
      {
        file: "src/handlers/unsafe.ts",
        symbol: "sanitizeOutgoingMentions",
      },
    ]);
  });

  test("keeps production outbound sanitizer usage behind the facade", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const files: Record<string, string> = {};

    function scan(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          scan(path);
          continue;
        }
        if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
          continue;
        }

        files[relative(repoRoot, path)] = readFileSync(path, "utf8");
      }
    }

    scan(join(repoRoot, "src"));

    expect(findDirectOutgoingPublicationSanitizerUsage({ files })).toEqual([]);
  });
});
