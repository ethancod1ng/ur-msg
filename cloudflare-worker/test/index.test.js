import assert from "node:assert/strict";
import test from "node:test";

import worker, {
  dispatchWorkflow,
  workflowForSchedule,
} from "../src/index.js";

function dashboardDb() {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("FROM monitor_runs mr")) {
            return {
              status: "success",
              completed_at: "2026-11-01T00:00:00Z",
              last_success_at: new Date().toISOString(),
            };
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM vacancies WHERE is_active = 1")) {
            return { results: [{ key: "room", city: "足立区", layout: "1LDK", first_seen_at: new Date().toISOString() }] };
          }
          return { results: [] };
        },
        async run() { return { success: true }; },
      };
    },
    async batch() { return []; },
  };
}

const env = {
  GITHUB_TOKEN: "test-token",
  GITHUB_OWNER: "ethancod1ng",
  GITHUB_REPO: "ur-msg",
  GITHUB_WORKFLOW: "monitor.yml",
  GITHUB_DAILY_WORKFLOW: "daily-digest.yml",
  GITHUB_REF: "main",
};

test("dispatches the monitor workflow on main", async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return new Response(null, { status: 204 });
  };

  await dispatchWorkflow(env, fakeFetch);

  assert.equal(
    request.url,
    "https://api.github.com/repos/ethancod1ng/ur-msg/actions/workflows/monitor.yml/dispatches",
  );
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(request.options.body), { ref: "main" });
});

test("accepts GitHub's 200 workflow dispatch response", async () => {
  const fakeFetch = async () =>
    Response.json(
      {
        workflow_run_id: 123,
        run_url: "https://api.github.com/repos/ethancod1ng/ur-msg/actions/runs/123",
      },
      { status: 200 },
    );

  await dispatchWorkflow(env, fakeFetch);
});

test("dispatches the daily digest workflow when selected", async () => {
  let requestUrl;
  const fakeFetch = async (url) => {
    requestUrl = url;
    return new Response(null, { status: 204 });
  };

  await dispatchWorkflow(env, fakeFetch, env.GITHUB_DAILY_WORKFLOW);

  assert.equal(
    requestUrl,
    "https://api.github.com/repos/ethancod1ng/ur-msg/actions/workflows/daily-digest.yml/dispatches",
  );
});

test("routes each cron schedule to the intended workflow", () => {
  assert.equal(workflowForSchedule("*/5 * * * *", env), "monitor.yml");
  assert.equal(workflowForSchedule("30 23 * * *", env), "daily-digest.yml");
  assert.throws(
    () => workflowForSchedule("0 0 * * *", env),
    /No workflow configured for schedule/,
  );
});

test("returns a healthy HTTP response", async () => {
  const response = await worker.fetch(new Request("https://example.com/health"));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ur-msg scheduler is healthy\n");
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
});

test("returns normalized vacancies from the public snapshot", async () => {
  const snapshot = {
    version: 1,
    vacancies: [{ key: "20_2250:room", building: "高島平", rent_yen: 96000 }],
  };
  const fakeFetch = async () =>
    Response.json(snapshot, {
      headers: { ETag: '"snapshot-etag"' },
    });

  const response = await worker.fetch(
    new Request("https://example.com/api/vacancies"),
    {},
    { waitUntil() {} },
    fakeFetch,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.version, 1);
  assert.equal(payload.count, 1);
  assert.deepEqual(payload.vacancies, snapshot.vacancies);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60, s-maxage=300");
});

test("reports snapshot fetch failures without caching them", async () => {
  const fakeFetch = async () => new Response("missing", { status: 404 });

  const response = await worker.fetch(
    new Request("https://example.com/api/vacancies"),
    {},
    { waitUntil() {} },
    fakeFetch,
  );

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /snapshot/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects malformed vacancy snapshots", async () => {
  const fakeFetch = async () => Response.json({ version: 1, vacancies: null });

  const response = await worker.fetch(
    new Request("https://example.com/api/vacancies"),
    {},
    { waitUntil() {} },
    fakeFetch,
  );

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /invalid/i);
});

test("forwards dashboard requests to static assets", async () => {
  let forwardedUrl;
  const assets = {
    async fetch(request) {
      forwardedUrl = request.url;
      return new Response("dashboard", { headers: { "Content-Type": "text/html" } });
    },
  };

  const response = await worker.fetch(
    new Request("https://example.com/"),
    { ASSETS: assets },
  );

  assert.equal(await response.text(), "dashboard");
  assert.equal(forwardedUrl, "https://example.com/");
});

test("returns the D1-backed dashboard", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/dashboard"),
    { DB: dashboardDb() },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.stats.vacancy_count, 1);
  assert.equal(payload.monitor.code, "healthy");
  assert.deepEqual(payload.filters.cities, ["足立区"]);
});

test("rejects unauthenticated snapshot writes", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
    { DB: dashboardDb(), SNAPSHOT_API_TOKEN: "secret" },
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("accepts an authenticated snapshot", async () => {
  const now = new Date().toISOString();
  const response = await worker.fetch(
    new Request("https://example.com/api/snapshots", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snapshot_id: "run-1",
        started_at: now,
        completed_at: now,
        status: "success",
        vacancies: [],
      }),
    }),
    { DB: dashboardDb(), SNAPSHOT_API_TOKEN: "secret" },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    duplicate: false,
    new_count: 0,
    removed_count: 1,
  });
});

test("rejects invalid snapshot content types", async () => {
  const response = await worker.fetch(
    new Request("https://example.com/api/snapshots", {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "text/plain" },
      body: "{}",
    }),
    { DB: dashboardDb(), SNAPSHOT_API_TOKEN: "secret" },
  );

  assert.equal(response.status, 415);
});

test("rejects a missing GitHub token before making a request", async () => {
  let called = false;
  const fakeFetch = async () => {
    called = true;
  };

  await assert.rejects(
    dispatchWorkflow({ ...env, GITHUB_TOKEN: "" }, fakeFetch),
    /GITHUB_TOKEN is not configured/,
  );
  assert.equal(called, false);
});

test("surfaces a bounded GitHub API error", async () => {
  const fakeFetch = async () =>
    new Response("permission denied", { status: 403 });

  await assert.rejects(
    dispatchWorkflow(env, fakeFetch),
    /GitHub workflow dispatch failed \(403\): permission denied/,
  );
});
