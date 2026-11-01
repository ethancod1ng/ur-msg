# Cloudflare scheduler and vacancy dashboard

This Worker triggers the existing GitHub Actions on two schedules:

- `monitor.yml` every five minutes.
- `daily-digest.yml` every day at 08:30 Japan time (`23:30` UTC).

It also serves a public, responsive vacancy dashboard from Workers Static Assets. The dashboard reads current vacancies and monitor health from Cloudflare D1 through `/api/dashboard`, refreshes every five minutes, and does not expose any GitHub or Telegram secrets. `/health` remains available for Worker health checks.

Successful monitor runs upload a complete snapshot to the authenticated `/api/snapshots` endpoint. D1 retains first/last-seen timestamps while the public API returns only active vacancies.

## One-time setup

1. Create a fine-grained GitHub personal access token restricted to `ethancod1ng/ur-msg` with repository permission `Actions: write`.
2. Install dependencies and authenticate Cloudflare:

   ```powershell
   npm install
   npx wrangler login
   ```

3. Store the token as a Cloudflare secret. Paste it only into Wrangler's prompt:

   ```powershell
   npx wrangler secret put GITHUB_TOKEN
   ```

4. Deploy:

   ```powershell
   npm run deploy
   ```

The D1 database is bound as `DB`. Apply schema migrations before deploying a schema change:

```powershell
npx wrangler d1 migrations apply ur-msg --remote
```

The following secrets configure snapshot uploads:

- Cloudflare Worker secret: `SNAPSHOT_API_TOKEN`
- GitHub Actions secrets: `SNAPSHOT_API_TOKEN` and `DASHBOARD_API_URL`

## Verification

Watch Worker logs with `npx wrangler tail`, then confirm a new run appears in GitHub Actions after the next five-minute boundary. GitHub labels these externally triggered runs as `workflow_dispatch`.

Open the deployed Worker URL to view the dashboard. Check `/api/dashboard` for the public D1-backed feed and `/health` for the scheduler health response.

After the external schedule is verified, remove the `schedule` block from `.github/workflows/monitor.yml` to prevent duplicate runs.

## Local checks

```powershell
npm test
npx wrangler deploy --dry-run
```

## Rollback

Delete or disable the Worker Cron Trigger in Cloudflare, then restore the `schedule` block in `monitor.yml`.
