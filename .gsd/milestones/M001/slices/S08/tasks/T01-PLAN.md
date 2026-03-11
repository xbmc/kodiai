# T01: 08-deployment 01

**Slice:** S08 — **Milestone:** M001

## Description

Create the Dockerfile and .dockerignore for the kodiai application, then verify the image builds and runs correctly locally.

Purpose: The application needs a Docker container for deployment to Azure Container Apps. The Dockerfile uses a multi-stage build with `oven/bun:1-alpine` to keep the image small while including all runtime dependencies (git for workspace cloning, production node_modules including the bundled Claude CLI via agent-sdk).

Output: A buildable Dockerfile and .dockerignore at project root. The image is verified to build and the health endpoint responds.

## Must-Haves

- [ ] "docker build completes successfully with no errors"
- [ ] "The built image contains only production dependencies and application source (no devDependencies, tmp/, .planning/, .git/)"
- [ ] "The container runs as non-root user 'bun'"
- [ ] "git is available inside the container"
- [ ] "The health endpoint responds inside the container"

## Files

- `Dockerfile`
- `.dockerignore`
