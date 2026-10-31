import assert from "node:assert/strict";
import test from "node:test";

import { dispatchWorkflow } from "../src/index.js";

const env = {
  GITHUB_TOKEN: "test-token",
  GITHUB_OWNER: "ethancod1ng",
  GITHUB_REPO: "ur-msg",
  GITHUB_WORKFLOW: "monitor.yml",
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
