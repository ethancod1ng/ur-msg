const requiredKeys = [
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "GITHUB_WORKFLOW",
  "GITHUB_REF",
];

export async function dispatchWorkflow(env, fetchImpl = fetch) {
  for (const key of requiredKeys) {
    if (!env[key]) {
      throw new Error(`${key} is not configured`);
    }
  }

  const owner = encodeURIComponent(env.GITHUB_OWNER);
  const repo = encodeURIComponent(env.GITHUB_REPO);
  const workflow = encodeURIComponent(env.GITHUB_WORKFLOW);
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;

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

  if (response.status !== 204) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(
      `GitHub workflow dispatch failed (${response.status}): ${details}`,
    );
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatchWorkflow(env));
  },
};
