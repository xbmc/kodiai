---
phase: quick-5
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/config.ts
  - src/routes/slack-events.test.ts
  - src/routes/slack-events.ts
  - src/slack/client.test.ts
  - src/slack/client.ts
  - src/slack/safety-rails.test.ts
  - src/slack/safety-rails.ts
  - src/slack/types.ts
autonomous: false
requirements: []
must_haves:
  truths:
    - "All uncommitted src/ changes are committed on feat/issue-write-pr"
    - "main branch contains all feature branch work"
    - "main is pushed to origin/main"
    - "Azure Container App ca-kodiai is running the new image"
    - "All 1102+ tests pass before merge"
  artifacts:
    - path: "kodiairegistry.azurecr.io/kodiai:latest"
      provides: "Updated Docker image in ACR"
  key_links:
    - from: "feat/issue-write-pr"
      to: "main"
      via: "git merge"
    - from: "main"
      to: "origin/main"
      via: "git push"
    - from: "kodiairegistry.azurecr.io/kodiai:latest"
      to: "ca-kodiai"
      via: "az containerapp update"
---

<objective>
Merge feat/issue-write-pr branch to main and redeploy to Azure Container Apps.

Purpose: Ship all Slack integration, safety rails, and milestone work from the feature branch to production.
Output: Updated production deployment on Azure Container Apps.
</objective>

<context>
Branch state:
- feat/issue-write-pr: 160 commits ahead of origin, has 8 uncommitted src/ files (428 lines changed)
- Local main: ahead 46 / behind 42 from origin/main (diverged)
- All local main commits already exist in feat/issue-write-pr (previously merged)
- origin/main has 42 commits from PRs merged via GitHub that local main lacks

Strategy: Commit working changes, sync local main to origin/main, merge feature branch, push, deploy.

Infrastructure:
- ACR: kodiairegistry.azurecr.io
- Container App: ca-kodiai in rg-kodiai
- Image: kodiairegistry.azurecr.io/kodiai:latest
- Dockerfile: multi-stage bun alpine build
- CI: GitHub Actions runs `bun test` and `bunx tsc --noEmit` on push to main
</context>

<tasks>

<task type="auto">
  <name>Task 1: Commit uncommitted changes and ensure tests pass</name>
  <files>
    src/config.ts
    src/routes/slack-events.test.ts
    src/routes/slack-events.ts
    src/slack/client.test.ts
    src/slack/client.ts
    src/slack/safety-rails.test.ts
    src/slack/safety-rails.ts
    src/slack/types.ts
  </files>
  <action>
    1. Stage all 8 uncommitted src/ files on feat/issue-write-pr
    2. Commit with message describing the Slack write-mode / safety-rails changes
    3. Run `bun test` to confirm all tests pass
    4. Run `bunx tsc --noEmit` to confirm no type errors
  </action>
  <verify>`bun test` shows 0 failures; `bunx tsc --noEmit` exits 0</verify>
  <done>All working changes committed, tests green, types clean</done>
</task>

<task type="auto">
  <name>Task 2: Merge feature branch to main and push</name>
  <files></files>
  <action>
    1. Fetch origin to ensure up-to-date refs: `git fetch origin`
    2. Switch to main: `git checkout main`
    3. Reset local main to origin/main to resolve divergence: `git reset --hard origin/main`
       (Safe because all 46 local-only main commits already exist in feat/issue-write-pr)
    4. Merge feat/issue-write-pr into main: `git merge feat/issue-write-pr --no-edit`
       This should be a clean fast-forward or simple merge since the feature branch already incorporated origin/main.
    5. Run `bun test` on merged main to confirm nothing broke
    6. Push main to origin: `git push origin main`
    7. Switch back to feat/issue-write-pr: `git checkout feat/issue-write-pr`
  </action>
  <verify>`git log origin/main --oneline -3` shows feature branch commits; CI passes on GitHub</verify>
  <done>origin/main contains all feat/issue-write-pr work, GitHub CI triggered</done>
</task>

<task type="auto">
  <name>Task 3: Build and deploy to Azure Container Apps</name>
  <files></files>
  <action>
    1. Log into ACR: `az acr login --name kodiairegistry`
    2. Build Docker image: `docker build -t kodiairegistry.azurecr.io/kodiai:latest .`
    3. Push to ACR: `docker push kodiairegistry.azurecr.io/kodiai:latest`
    4. Update Container App to pull new image:
       `az containerapp update --name ca-kodiai --resource-group rg-kodiai --image kodiairegistry.azurecr.io/kodiai:latest`
    5. Wait ~30s then verify the app is running:
       `az containerapp show --name ca-kodiai --resource-group rg-kodiai --query "properties.runningStatus" -o tsv`
  </action>
  <verify>
    `az containerapp show --name ca-kodiai --resource-group rg-kodiai --query "properties.latestRevisionName" -o tsv` returns new revision;
    `curl -s https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/health` returns 200 (or equivalent health endpoint)
  </verify>
  <done>Azure Container App ca-kodiai running latest image with all feature branch changes</done>
</task>

</tasks>

<verification>
- `git log origin/main --oneline -5` shows feature branch commits at top
- GitHub Actions CI passes on main push
- `az containerapp show --name ca-kodiai --resource-group rg-kodiai` shows latest revision
- Application health check responds
</verification>

<success_criteria>
- All src/ changes committed on feature branch
- main branch merged with all 160+ feature branch commits
- origin/main pushed and CI green
- Azure Container App ca-kodiai running updated image
</success_criteria>
