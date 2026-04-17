import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const deployScript = readFileSync(join(import.meta.dir, "..", "deploy.sh"), "utf8");

describe("deploy.sh", () => {
  test("pins the app image by digest instead of mutable :latest in the update template", () => {
    expect(deployScript).toContain('APP_IMAGE="${ACR_NAME}.azurecr.io/kodiai@${APP_IMAGE_DIGEST}"');
    expect(deployScript).toContain('image: ${APP_IMAGE}');
  });

  test("captures ACR build digests without streaming logs into shell variables", () => {
    expect(deployScript).toContain('--no-logs');
  });

  test("pins the ACA job image by digest instead of mutable :latest", () => {
    expect(deployScript).toContain('ACA_JOB_IMAGE="${ACR_NAME}.azurecr.io/kodiai-agent@${ACA_JOB_IMAGE_DIGEST}"');
  });

  test("wires revisionSuffix into the container app template", () => {
    expect(deployScript).toContain('revisionSuffix: ${REVISION_SUFFIX}');
  });

  test("reports the traffic-bearing active revision before falling back to the newest active revision", () => {
    expect(deployScript).toContain('properties.trafficWeight > `0`');
    expect(deployScript).toContain('sort_by(@, &properties.createdTime) | [-1].name');
    expect(deployScript).toContain('ACTIVE_REVISION=${TRAFFIC_ACTIVE_REVISION:-$NEWEST_ACTIVE_REVISION}');
  });

  test("syncs CLAUDE_CODE_OAUTH_TOKEN from machine Claude credentials when available", () => {
    expect(deployScript).toContain('CLAUDE_CREDENTIALS_FILE=${CLAUDE_CREDENTIALS_FILE:-$HOME/.claude/.credentials.json}');
    expect(deployScript).toContain('claudeAiOauth.accessToken');
    expect(deployScript).toContain('CLAUDE_CODE_OAUTH_TOKEN="$machine_token"');
  });

  test("persists the refreshed Claude OAuth token back into ENV_FILE", () => {
    expect(deployScript).toContain('awk -v tok="$machine_token"');
    expect(deployScript).toContain('print "CLAUDE_CODE_OAUTH_TOKEN=" tok;');
    expect(deployScript).toContain('Synced CLAUDE_CODE_OAUTH_TOKEN from $CLAUDE_CREDENTIALS_FILE into $ENV_FILE');
  });

  test("runs Claude OAuth sync before required env validation", () => {
    const syncIndex = deployScript.indexOf('sync_claude_oauth_token_from_machine');
    const missingIndex = deployScript.indexOf('missing=()');

    expect(syncIndex).toBeGreaterThan(-1);
    expect(missingIndex).toBeGreaterThan(-1);
    expect(syncIndex).toBeLessThan(missingIndex);
  });
});
