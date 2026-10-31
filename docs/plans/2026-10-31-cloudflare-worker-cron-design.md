# Cloudflare Worker Cron Design

Cloudflare Worker Cron replaces GitHub's unreliable `schedule` event as the timer while preserving the existing GitHub Actions execution environment.

Every five minutes, Cloudflare invokes a module Worker. The Worker sends an authenticated `POST` request to GitHub's workflow-dispatch endpoint for `.github/workflows/monitor.yml` on `main`. GitHub then runs the existing tests, vacancy monitor, Telegram notification, and snapshot commit steps unchanged.

The GitHub fine-grained token is stored only as the Cloudflare secret `GITHUB_TOKEN`. It must be limited to the `ethancod1ng/ur-msg` repository with `Actions: write`. Repository, workflow, and branch identifiers are non-secret Worker variables. The Worker treats GitHub's `204 No Content` response as success and throws an error containing only the HTTP status and a bounded response body for any failure. It never logs the token.

The Worker code has no production dependencies. Node's built-in test runner verifies the request URL, headers, request body, missing-secret behavior, and GitHub error propagation. Cloudflare logs provide scheduler and dispatch failures; GitHub Actions remains the source of execution logs.

Deployment is staged safely: deploy and configure the Worker first, verify at least one externally dispatched run, then remove the native GitHub `schedule` entry to prevent duplicate checks.
