# Cloudflare scheduler

This Worker triggers the existing `monitor.yml` GitHub Action every five minutes.

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

## Verification

Watch Worker logs with `npx wrangler tail`, then confirm a new run appears in GitHub Actions after the next five-minute boundary. GitHub labels these externally triggered runs as `workflow_dispatch`.

After the external schedule is verified, remove the `schedule` block from `.github/workflows/monitor.yml` to prevent duplicate runs.

## Local checks

```powershell
npm test
npx wrangler deploy --dry-run
```

## Rollback

Delete or disable the Worker Cron Trigger in Cloudflare, then restore the `schedule` block in `monitor.yml`.
