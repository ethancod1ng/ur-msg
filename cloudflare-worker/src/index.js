const requiredKeys = [
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "GITHUB_REF",
];

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
  async fetch() {
    return new Response("ur-msg scheduler is healthy\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },

  async scheduled(controller, env, ctx) {
    const workflow = workflowForSchedule(controller.cron, env);
    ctx.waitUntil(dispatchWorkflow(env, fetch, workflow));
  },
};
