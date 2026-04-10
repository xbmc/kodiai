# M044 Secrets Manifest

M044's live audit and rerunnable verifier are expected to need local operator access to GitHub App credentials and the production-like PostgreSQL connection string.

Azure Log Analytics / Container Apps log access is also a prerequisite for the explicit mention lane, but that is expected to come from existing `az login` / workspace access rather than a new dotenv secret.

### GITHUB_PRIVATE_KEY_BASE64

- **Service** — GitHub App
- **Dashboard** — https://github.com/settings/apps
- **Format hint** — base64-encoded PEM (`LS0tLS1CRUdJTi...`)
- **Status** — pending
- **Destination** — dotenv

1. Open GitHub App settings at the dashboard URL above.
2. Select the Kodiai GitHub App used for this environment.
3. Open the app's **Private keys** section.
4. Generate or download the current private key PEM.
5. Base64-encode the PEM contents without changing line endings.
6. Store the encoded value as `GITHUB_PRIVATE_KEY_BASE64` in local dotenv for the audit/verifier commands.

### DATABASE_URL

- **Service** — Azure Database for PostgreSQL
- **Dashboard** — https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.DBforPostgreSQL%2FflexibleServers
- **Format hint** — `postgresql://user:password@host:5432/dbname?sslmode=require`
- **Status** — pending
- **Destination** — dotenv

1. Open the Azure PostgreSQL servers view at the dashboard URL above.
2. Select the PostgreSQL server that backs the Kodiai environment being audited.
3. Open the connection-string or connection-details panel for the target database.
4. Copy the SSL-enabled application connection string for the audit database.
5. Verify the database name and host match the environment you intend to audit.
6. Store the value as `DATABASE_URL` in local dotenv for the audit/verifier commands.
