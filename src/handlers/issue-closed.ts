/**
 * Handler for issues.closed webhook events.
 *
 * Captures outcome data when issues are closed, linking back to triage records
 * for feedback-loop learning. Classifies outcomes from state_reason and labels.
 *
 * Idempotency: ON CONFLICT (delivery_id) DO NOTHING (Layer 2).
 * Layer 1 is the in-memory Deduplicator at webhook route level.
 *
 * Fails open: errors are logged but never propagate.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { EventRouter, WebhookEvent } from "../webhook/types.ts";

export function createIssueClosedHandler(deps: {
  eventRouter: EventRouter;
  sql: Sql;
  logger: Logger;
}): void {
  const { eventRouter, sql, logger } = deps;

  async function handleIssueClosed(event: WebhookEvent): Promise<void> {
    try {
      // 1. Extract and validate payload
      const payload = event.payload as {
        action: "closed";
        issue?: {
          number: number;
          title: string;
          body: string | null;
          state: "closed";
          state_reason: "completed" | "not_planned" | "duplicate" | null;
          labels: Array<{ name: string }>;
          pull_request?: unknown;
          user?: { login: string };
          closed_at: string;
        };
        repository?: {
          full_name: string;
          name: string;
          owner?: { login: string };
        };
      };

      const issue = payload.issue;
      const repository = payload.repository;

      if (!issue || !repository || !repository.owner) {
        logger.debug({ deliveryId: event.id }, "Missing issue or repo in payload");
        return;
      }

      const repo = repository.full_name;
      const issueNumber = issue.number;
      const deliveryId = event.id;

      const handlerLogger = logger.child({
        handler: "issue-closed",
        repo,
        issueNumber,
        deliveryId,
      });

      // 2. Filter out pull requests (OUTCOME-04)
      // GitHub fires issues.closed for PRs too
      if (issue.pull_request) {
        handlerLogger.debug("Pull request closure, skipping");
        return;
      }

      // 3. Classify outcome (OUTCOME-01, OUTCOME-02)
      const stateReason = issue.state_reason;
      const labels: Array<{ name: string }> = issue.labels ?? [];
      let outcome: string;
      let confirmedDuplicate = false;

      if (stateReason === "duplicate") {
        outcome = "duplicate";
        confirmedDuplicate = true;
      } else if (stateReason === "completed") {
        outcome = "completed";
      } else if (stateReason === "not_planned") {
        outcome = "not_planned";
      } else {
        // state_reason is null -- fallback to label check
        // Use exact match for "duplicate" label (not substring, not "possible-duplicate")
        const hasDuplicateLabel = labels.some((l) => l.name === "duplicate");
        if (hasDuplicateLabel) {
          outcome = "duplicate";
          confirmedDuplicate = true;
        } else {
          outcome = "unknown";
        }
      }

      // 4. Look up triage record for linkage (OUTCOME-03)
      const triageRows = await sql`
        SELECT id, duplicate_count
        FROM issue_triage_state
        WHERE repo = ${repo} AND issue_number = ${issueNumber}
      `;

      const triageId = triageRows.length > 0 ? (triageRows[0].id as number) : null;
      const kodiaiPredictedDuplicate = triageRows.length > 0 && (triageRows[0].duplicate_count as number) > 0;

      // 5. Extract label names for raw signal storage
      const labelNames = labels.map((l) => l.name);

      // 6. Insert outcome record with delivery-ID idempotency (OUTCOME-05)
      const result = await sql`
        INSERT INTO issue_outcome_feedback (
          repo, issue_number, triage_id, outcome,
          kodiai_predicted_duplicate, confirmed_duplicate,
          state_reason, label_names, delivery_id
        )
        VALUES (
          ${repo}, ${issueNumber}, ${triageId}, ${outcome},
          ${kodiaiPredictedDuplicate}, ${confirmedDuplicate},
          ${stateReason}, ${labelNames}, ${deliveryId}
        )
        ON CONFLICT (delivery_id) DO NOTHING
        RETURNING id
      `;

      if (result.length === 0) {
        handlerLogger.info("Outcome already recorded (delivery-ID dedup), skipping");
        return;
      }

      handlerLogger.info(
        { outcome, confirmedDuplicate, kodiaiPredictedDuplicate, triageId },
        "Issue outcome captured",
      );
    } catch (err) {
      logger.error(
        { err, deliveryId: event.id },
        "Issue closed handler failed (non-fatal)",
      );
    }
  }

  eventRouter.register("issues.closed", handleIssueClosed);
}
