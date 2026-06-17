import type { Sql } from "../db/client.ts";

export type IssueTriageStateStore = {
  claim(input: {
    repo: string;
    issueNumber: number;
    deliveryId: string;
    cooldownMinutes: number;
  }): Promise<IssueTriageClaim | null>;
};

export type IssueTriageClaim = {
  deliveryId: string;
  recordDuplicateCount(input: {
    duplicateCount: number;
  }): Promise<boolean>;
  confirmPublish(): Promise<boolean>;
  storeCommentId(input: {
    commentGithubId: number;
  }): Promise<boolean>;
};

export function createIssueTriageStateStore(sql: Sql): IssueTriageStateStore {
  return {
    async claim({ repo, issueNumber, deliveryId, cooldownMinutes }) {
      const result = await sql`
        INSERT INTO issue_triage_state (repo, issue_number, delivery_id, duplicate_count)
        VALUES (${repo}, ${issueNumber}, ${deliveryId}, NULL)
        ON CONFLICT (repo, issue_number) DO UPDATE
          SET delivery_id = ${deliveryId},
              triaged_at = now(),
              duplicate_count = NULL
          WHERE issue_triage_state.triaged_at < now() - ${cooldownMinutes + ' minutes'}::interval
        RETURNING delivery_id
      `;
      if (result.length === 0) {
        return null;
      }

      const activeDeliveryId = result[0]!.delivery_id as string;
      return {
        deliveryId: activeDeliveryId,

        async recordDuplicateCount({ duplicateCount }) {
          const result = await sql`
            UPDATE issue_triage_state
            SET duplicate_count = ${duplicateCount}
            WHERE repo = ${repo}
              AND issue_number = ${issueNumber}
              AND delivery_id = ${activeDeliveryId}
              AND duplicate_count IS NULL
            RETURNING id
          `;
          return result.length > 0;
        },

        async confirmPublish() {
          const result = await sql`
            SELECT id
            FROM issue_triage_state
            WHERE repo = ${repo}
              AND issue_number = ${issueNumber}
              AND delivery_id = ${activeDeliveryId}
              AND duplicate_count IS NOT NULL
          `;
          return result.length > 0;
        },

        async storeCommentId({ commentGithubId }) {
          const result = await sql`
            UPDATE issue_triage_state
            SET comment_github_id = ${commentGithubId}
            WHERE repo = ${repo}
              AND issue_number = ${issueNumber}
              AND delivery_id = ${activeDeliveryId}
            RETURNING id
          `;
          return result.length > 0;
        },
      };
    },
  };
}
