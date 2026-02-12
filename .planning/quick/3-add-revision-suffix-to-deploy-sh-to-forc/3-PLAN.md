---
phase: quick-3
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [deploy.sh]
autonomous: true

must_haves:
  truths:
    - "Every deployment creates a new Azure Container App revision"
    - "Revision suffix includes a timestamp for traceability"
  artifacts:
    - path: "deploy.sh"
      provides: "Deployment script with forced revision creation"
      contains: "--revision-suffix"
  key_links:
    - from: "deploy.sh"
      to: "az containerapp update"
      via: "--revision-suffix flag with timestamp"
      pattern: "revision-suffix.*date"
---

<objective>
Add --revision-suffix to the `az containerapp update` command in deploy.sh so every deployment forces a new revision.

Purpose: Without a revision suffix, Azure Container Apps sometimes updates metadata in place without creating a new revision, meaning the new container image never actually runs. Adding a timestamp-based revision suffix guarantees a new revision is created and activated on every deploy.

Output: Updated deploy.sh with forced revision creation.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@deploy.sh (lines 148-175 — the update branch of the deployment logic)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add --revision-suffix to az containerapp update</name>
  <files>deploy.sh</files>
  <action>
In deploy.sh, modify the `az containerapp update` command at line 162 (the update path for existing container apps, NOT the initial create path) to include a `--revision-suffix` flag.

Add a REVISION_SUFFIX variable before the update command (around line 161, after the echo statement on line 151):

```bash
REVISION_SUFFIX="deploy-$(date +%Y%m%d-%H%M%S)"
```

Then add `--revision-suffix "$REVISION_SUFFIX"` to the `az containerapp update` call on line 162. Place it after `--resource-group` and before `--image` for readability:

```bash
  az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --revision-suffix "$REVISION_SUFFIX" \
    --image "$ACR_NAME.azurecr.io/kodiai:latest" \
    ...
```

Also update the echo on line 151 to include the suffix for visibility:
```bash
echo "==> Updating existing container app (revision: $REVISION_SUFFIX)..."
```

Do NOT modify the `az containerapp create` branch (line 178+) — new apps already get a revision on creation. Do NOT modify the `az containerapp update` inside the YAML probe configuration block (line 251) — that is only run during initial creation.
  </action>
  <verify>Run `bash -n deploy.sh` to confirm no syntax errors. Grep for `--revision-suffix` to confirm the flag is present.</verify>
  <done>deploy.sh contains --revision-suffix with a timestamp-based suffix in the containerapp update command. Script passes bash syntax check.</done>
</task>

</tasks>

<verification>
- `bash -n deploy.sh` exits 0 (no syntax errors)
- `grep -n 'revision-suffix' deploy.sh` shows the flag in the update command
- The revision suffix uses a timestamp format (YYYYMMDD-HHMMSS) for traceability
- Only the existing-app update path is modified, not the create path
</verification>

<success_criteria>
- deploy.sh forces a new revision on every deployment via --revision-suffix
- Revision name includes a timestamp for deployment traceability
- Script remains syntactically valid
</success_criteria>

<output>
After completion, create `.planning/quick/3-add-revision-suffix-to-deploy-sh-to-forc/3-SUMMARY.md`
</output>
