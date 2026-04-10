# Secrets Manifest

**Milestone:** 
**Generated:** 

### GITHUB_APP_ID

**Service:** 
**Status:** pending
**Destination:** dotenv

1. Sign in to the GitHub account that owns the Kodiai GitHub App.
2. Open the GitHub Apps console at `https://github.com/settings/apps`.
3. Select the app that Kodiai uses for `xbmc/xbmc` access, or create it if it does not exist yet.
4. Copy the **App ID** from the app's General settings page.
5. Store it locally as `GITHUB_APP_ID` in the project dotenv environment.

### GITHUB_PRIVATE_KEY

**Service:** 
**Status:** skipped
**Destination:** dotenv

1. Sign in to the GitHub account that owns the Kodiai GitHub App.
2. Open the GitHub Apps console at `https://github.com/settings/apps` and select the Kodiai app used for `xbmc/xbmc`.
3. Open the app's **Private keys** section.
4. Generate a new private key and download the `.pem` file.
5. Either paste the PEM contents into `GITHUB_PRIVATE_KEY` or base64-encode the PEM and store that value as `GITHUB_PRIVATE_KEY_BASE64` in the project dotenv environment.
