# Cloudflare D1 UR Vacancy Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the public vacancy dashboard from the GitHub snapshot to Cloudflare D1, expose reliable monitor health, and preserve the current Cloudflare-triggered GitHub workflow.

**Architecture:** GitHub Actions continues fetching UR data, then uploads each complete snapshot to an authenticated Worker endpoint. The Worker validates and atomically writes D1; the public dashboard reads current active vacancies and monitor status from D1. The existing repository snapshot remains as a temporary rollback source during rollout.

**Tech Stack:** Cloudflare Workers, D1/SQLite migrations, vanilla JavaScript, Python 3.12, GitHub Actions, Node.js test runner.

---

### Task 1: Define and test the D1 data layer

**Files:**
- Create: `cloudflare-worker/migrations/0001_initial.sql`
- Create: `cloudflare-worker/src/database.js`
- Create: `cloudflare-worker/test/database.test.js`
- Modify: `cloudflare-worker/wrangler.jsonc`

**Steps:**
1. Write failing tests for status calculation, current-vacancy reads, idempotent snapshots, new/removed counts, and failure records.
2. Run `npm test` and confirm the new tests fail.
3. Add the D1 schema and database functions.
4. Run tests and a local D1 migration.

### Task 2: Add authenticated snapshot and dashboard APIs

**Files:**
- Modify: `cloudflare-worker/src/index.js`
- Modify: `cloudflare-worker/test/index.test.js`

**Steps:**
1. Write failing route tests for `GET /api/dashboard` and `POST /api/snapshots`.
2. Cover authentication, content type, size, field validation, duplicate snapshots, and safe errors.
3. Implement routing and response caching.
4. Run Worker tests.

### Task 3: Upload monitor results from GitHub Actions

**Files:**
- Modify: `src/ur_monitor.py`
- Modify: `tests/test_ur_monitor.py`
- Modify: `.github/workflows/monitor.yml`

**Steps:**
1. Add failing Python tests for snapshot payload construction and authenticated upload.
2. Implement a post-success snapshot upload that does not expose its token.
3. Configure the workflow to use `DASHBOARD_API_URL` and `SNAPSHOT_API_TOKEN` secrets.
4. Keep `data/state.json` persistence temporarily for rollback.
5. Run the Python test suite.

### Task 4: Implement the approved single-page dashboard

**Files:**
- Modify: `cloudflare-worker/public/index.html`
- Modify: `cloudflare-worker/public/styles.css`
- Modify: `cloudflare-worker/public/app.js`

**Steps:**
1. Add healthy, delayed, and unhealthy monitor states.
2. Add city, layout, maximum monthly total, and maximum commute filters.
3. Display monthly total prominently and split rent/common fee beneath it.
4. Sort new vacancies first, then monthly total ascending.
5. Verify loading, errors, no current vacancies, and no filter matches.

### Task 5: Provision, migrate, and deploy safely

**Files:**
- Modify: `cloudflare-worker/wrangler.jsonc`
- Modify: `cloudflare-worker/README.md`
- Modify: `README.md`

**Steps:**
1. Create the remote D1 database and bind its generated ID.
2. Apply the remote migration.
3. Generate one snapshot token and store it only in Cloudflare and GitHub secrets.
4. Deploy the Worker with the D1-backed API.
5. Seed D1 from the current `data/state.json` through the authenticated endpoint.
6. Verify the live API and responsive page before pushing workflow changes.
7. Commit and push the source, then confirm the next scheduled run writes D1.
8. Keep the previous Worker deployment and `state.json` path available for rollback.

