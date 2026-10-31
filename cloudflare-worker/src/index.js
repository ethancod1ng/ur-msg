const requiredKeys = [
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "GITHUB_REF",
];

const API_CACHE_CONTROL = "public, max-age=60, s-maxage=300";

function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(payload, { ...init, headers });
}

function snapshotUrl(env) {
  const owner = encodeURIComponent(env.GITHUB_OWNER || "ethancod1ng");
  const repo = encodeURIComponent(env.GITHUB_REPO || "ur-msg");
  const ref = encodeURIComponent(env.GITHUB_REF || "main");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/data/state.json`;
}

export async function vacancyResponse(env, fetchImpl = fetch) {
  let upstream;
  try {
    upstream = await fetchImpl(snapshotUrl(env), {
      headers: { Accept: "application/json", "User-Agent": "ur-msg-dashboard" },
      cf: { cacheEverything: true, cacheTtl: 300 },
    });
  } catch {
    return jsonResponse(
      { error: "Vacancy snapshot is temporarily unavailable." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!upstream.ok) {
    return jsonResponse(
      { error: `Vacancy snapshot request failed (${upstream.status}).` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  let snapshot;
  try {
    snapshot = await upstream.json();
  } catch {
    snapshot = null;
  }
  if (!snapshot || !Array.isArray(snapshot.vacancies)) {
    return jsonResponse(
      { error: "Invalid vacancy snapshot received." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  return jsonResponse(
    {
      version: snapshot.version || 1,
      count: snapshot.vacancies.length,
      synchronized_at: new Date().toISOString(),
      vacancies: snapshot.vacancies,
    },
    { headers: { "Cache-Control": API_CACHE_CONTROL } },
  );
}

export function workflowForSchedule(cron, env) {
  const workflows = {
    "*/5 * * * *": env.GITHUB_WORKFLOW,
    "30 23 * * *": env.GITHUB_DAILY_WORKFLOW,
  };
  const workflow = workflows[cron];

  if (!workflow) {
    throw new Error(`No workflow configured for schedule: ${cron}`);
  }

  return workflow;
}

export async function dispatchWorkflow(
  env,
  fetchImpl = fetch,
  workflow = env.GITHUB_WORKFLOW,
) {
  for (const key of requiredKeys) {
    if (!env[key]) {
      throw new Error(`${key} is not configured`);
    }
  }
  if (!workflow) {
    throw new Error("GitHub workflow is not configured");
  }

  const owner = encodeURIComponent(env.GITHUB_OWNER);
  const repo = encodeURIComponent(env.GITHUB_REPO);
  const encodedWorkflow = encodeURIComponent(workflow);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodedWorkflow}/dispatches`;

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ur-msg-cloudflare-scheduler",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: JSON.stringify({ ref: env.GITHUB_REF }),
  });

  if (response.status !== 200 && response.status !== 204) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(
      `GitHub workflow dispatch failed (${response.status}): ${details}`,
    );
  }
}

export default {
  async fetch(request, env = {}, _ctx, fetchImpl = fetch) {
    const url = new URL(request.url);
    if (url.pathname === "/api/vacancies") {
      return vacancyResponse(env, fetchImpl);
    }
    if (url.pathname === "/health") {
      return new Response("ur-msg scheduler is healthy\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("ur-msg scheduler is healthy\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },

  async scheduled(controller, env, ctx) {
    const workflow = workflowForSchedule(controller.cron, env);
    ctx.waitUntil(dispatchWorkflow(env, fetch, workflow));
  },
};
