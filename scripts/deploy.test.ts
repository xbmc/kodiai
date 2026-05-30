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

  test("builds deployment context from an explicit git commit hash", () => {
    expect(deployScript).toContain('SOURCE_COMMIT=${DEPLOY_SOURCE_COMMIT:-$(git rev-parse --verify HEAD)}');
    expect(deployScript).toContain('git archive --format=tar "$SOURCE_COMMIT"');
    expect(deployScript).toContain('SOURCE_COMMIT_SHORT=$(git rev-parse --short=12 "$SOURCE_COMMIT")');
    expect(deployScript).not.toContain('cp -R src/. "$BUILD_CONTEXT_DIR/src/"');
  });

  test("injects source commit provenance into app and job runtime configuration", () => {
    expect(deployScript).toContain('REVISION_SUFFIX="deploy-${SOURCE_COMMIT_SHORT}-$(date +%Y%m%d-%H%M%S)"');
    expect(deployScript).toContain('- name: SOURCE_COMMIT');
    expect(deployScript).toContain('value: ${SOURCE_COMMIT}');
    expect(deployScript).toContain('SOURCE_COMMIT="$SOURCE_COMMIT"');
  });

  test("fails deploy when the selected git commit cannot be verified", () => {
    expect(deployScript).toContain('git rev-parse --verify "${SOURCE_COMMIT}^{commit}"');
    expect(deployScript).toContain('ERROR: DEPLOY_SOURCE_COMMIT');
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

  test("mirrors the Bun base image into ACR and builds from the mirror", () => {
    expect(deployScript).toContain("BUN_BASE_SOURCE_IMAGE=${BUN_BASE_SOURCE_IMAGE:-docker.io/oven/bun:1-debian}");
    expect(deployScript).toContain("BUN_BASE_ACR_IMAGE=${BUN_BASE_ACR_IMAGE:-base/oven-bun:1-debian}");
    expect(deployScript).toContain('az acr import "${ACR_IMPORT_ARGS[@]}"');
    expect(deployScript).toContain('ACR_IMPORT_ARGS+=(--username "$DOCKERHUB_USERNAME" --password "$DOCKERHUB_TOKEN")');
    expect(deployScript).toContain('--build-arg "BUN_BASE_IMAGE=$BUN_BASE_IMAGE"');
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
