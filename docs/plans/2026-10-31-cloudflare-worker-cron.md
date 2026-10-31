# Cloudflare Worker Cron Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Trigger the existing vacancy-monitor GitHub Action every five minutes from Cloudflare Worker Cron.

**Architecture:** A small module Worker receives Cloudflare scheduled events and calls GitHub's workflow-dispatch REST endpoint. The GitHub token remains a Cloudflare secret, and the existing Python workflow continues to perform all monitoring and state persistence.

**Tech Stack:** Cloudflare Workers, JavaScript ES modules, Node.js built-in test runner, Wrangler.

---

### Task 1: Worker dispatch module

**Files:**
- Create: `cloudflare-worker/src/index.js`
- Create: `cloudflare-worker/test/index.test.js`
- Create: `cloudflare-worker/package.json`

**Steps:**
1. Write tests for successful dispatch, missing secrets, and GitHub errors.
2. Run `npm test` from `cloudflare-worker` and confirm the tests fail before implementation.
3. Implement the scheduled handler and injectable dispatch function.
4. Run `npm test` and confirm all tests pass.

### Task 2: Cloudflare configuration and operator documentation

**Files:**
- Create: `cloudflare-worker/wrangler.jsonc`
- Create: `cloudflare-worker/README.md`
- Modify: `.gitignore`

**Steps:**
1. Configure `*/5 * * * *`, observability, and non-secret GitHub identifiers.
2. Document login, secret creation, deployment, verification, and rollback.
3. Ignore Wrangler's local state directory.
4. Run tests and `npx wrangler deploy --dry-run`.

### Task 3: Deploy and cut over

**Files:**
- Modify after successful verification: `.github/workflows/monitor.yml`

**Steps:**
1. Authenticate Wrangler with the user's Cloudflare account.
2. Store the fine-grained GitHub token with `wrangler secret put GITHUB_TOKEN`.
3. Deploy the Worker.
4. Verify a GitHub run whose event is `workflow_dispatch` arrives after a scheduled Cloudflare invocation.
5. Remove the native GitHub `schedule` trigger, run all tests, commit, and push.
