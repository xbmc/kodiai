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
});
