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

  test("does not auto-sync CLAUDE_CODE_OAUTH_TOKEN from machine Claude credentials", () => {
    expect(deployScript).not.toContain('sync_claude_oauth_token_from_machine');
    expect(deployScript).not.toContain('CLAUDE_CODE_OAUTH_TOKEN="$machine_token"');
    expect(deployScript).not.toContain('Synced CLAUDE_CODE_OAUTH_TOKEN from $CLAUDE_CREDENTIALS_FILE');
  });

  test("guards against using the rotating Claude login access token for deploy auth", () => {
    expect(deployScript).toContain('CLAUDE_CREDENTIALS_FILE=${CLAUDE_CREDENTIALS_FILE:-$HOME/.claude/.credentials.json}');
    expect(deployScript).toContain('claudeAiOauth.accessToken');
    expect(deployScript).toContain('CLAUDE_CODE_OAUTH_TOKEN matches $CLAUDE_CREDENTIALS_FILE accessToken');
    expect(deployScript).toContain('Use the 1-year token from `claude setup-token`');
  });

  test("runs Claude OAuth source validation before required env validation", () => {
    const validationIndex = deployScript.indexOf('validate_claude_oauth_token_source');
    const missingIndex = deployScript.indexOf('missing=()');

    expect(validationIndex).toBeGreaterThan(-1);
    expect(missingIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(missingIndex);
  });
});
