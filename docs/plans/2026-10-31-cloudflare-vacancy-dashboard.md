# Cloudflare UR Vacancy Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish a free, public, mobile-friendly dashboard showing the latest matching UR vacancies from the repository snapshot.

**Architecture:** The existing Cloudflare Worker continues dispatching GitHub workflows. A new `/api/vacancies` route fetches the public `data/state.json` snapshot with a short cache, while Cloudflare Workers Static Assets serves the dashboard at `/`. No new database, paid service, or secret is required.

**Tech Stack:** Cloudflare Workers, Workers Static Assets, vanilla HTML/CSS/JavaScript, Node.js built-in test runner.

---

### Task 1: Add the vacancy API

**Files:**
- Modify: `cloudflare-worker/src/index.js`
- Modify: `cloudflare-worker/test/index.test.js`

**Steps:**
1. Add failing tests for `/api/vacancies`, static asset forwarding, upstream failures, and malformed snapshots.
2. Run `npm test` and confirm the new tests fail.
3. Implement request routing and normalize the GitHub snapshot into a versioned API response.
4. Cache successful upstream reads for five minutes without caching failures.
5. Run `npm test` and confirm all tests pass.

### Task 2: Build the responsive dashboard

**Files:**
- Create: `cloudflare-worker/public/index.html`
- Create: `cloudflare-worker/public/styles.css`
- Create: `cloudflare-worker/public/app.js`
- Modify: `cloudflare-worker/wrangler.jsonc`

**Steps:**
1. Create accessible semantic markup with loading, error, empty, and populated states.
2. Render vacancy cards with rent, fees, layout, floor area, commute time, access, and official UR links.
3. Add rent/layout/city sorting and filtering that runs entirely in the browser.
4. Refresh from the API every five minutes and show the page synchronization time.
5. Bind `public/` as Workers Static Assets and route only `/api/*` through Worker code first.

### Task 3: Verify and document

**Files:**
- Modify: `cloudflare-worker/README.md`
- Modify: `README.md`

**Steps:**
1. Document the public dashboard and data flow.
2. Run `npm test` and `npx wrangler deploy --dry-run`.
3. Start the local Worker, inspect the API response, and visually check the desktop and mobile layouts.
4. Deploy with `npm run deploy` and verify the live URL if Cloudflare authentication is still active.

