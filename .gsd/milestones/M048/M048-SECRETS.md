# Secrets Manifest

**Milestone:** 
**Generated:** 

### GITHUB_PRIVATE_KEY

**Service:** 
**Status:** skipped
**Destination:** dotenv

1. Open GitHub App settings and select the Kodiai app used for live webhook and review execution.
2. Open the app's **Private keys** page.
3. Generate a new private key if no current key is available.
4. Download the `.pem` file and open it in a text editor.
5. Copy the full PEM contents, including the begin/end lines, into `GITHUB_PRIVATE_KEY`.

### GITHUB_WEBHOOK_SECRET

**Service:** 
**Status:** pending
**Destination:** dotenv

1. Open GitHub App settings and select the Kodiai app used for production-like review traffic.
2. Open the app's **Webhook** or **General** settings where the webhook secret is configured.
3. Reveal the existing secret if the organization allows it, or rotate it to generate a fresh one.
4. Copy the secret value exactly as configured for the webhook endpoint.
5. Store it in `GITHUB_WEBHOOK_SECRET` so local verification matches GitHub's signed payloads.

### ANTHROPIC_API_KEY

**Service:** 
**Status:** skipped
**Destination:** dotenv

1. Sign in to the Anthropic Console for the account that backs Kodiai review execution.
2. Open **API Keys**.
3. Create a new API key if no valid key is already available for Kodiai.
4. Copy the generated key immediately; the console may not show it again.
5. Store it in `ANTHROPIC_API_KEY` for local or verifier runs when `CLAUDE_CODE_OAUTH_TOKEN` is not already provisioned.

### DATABASE_URL

**Service:** 
**Status:** pending
**Destination:** dotenv

1. Open the Azure Portal flexible server used by Kodiai's telemetry and knowledge stores.
2. Open the server's connection-string or overview page and identify the database host, database name, and admin username.
3. If the password is unavailable, reset the server admin password or retrieve the application credential from the team's secret manager.
4. Assemble the full PostgreSQL connection string with `sslmode=require`.
5. Store the result in `DATABASE_URL` for local verification and durable evidence reads.
