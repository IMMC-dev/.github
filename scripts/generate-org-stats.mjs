#!/usr/bin/env node
/**
 * generate-org-stats.mjs
 *
 * Builds an org-wide "GitHub stats" SVG card (stars, forks, repos, issues,
 * merged PRs, top languages) for use in an organization profile README.
 *
 * Requires Node 20+ (uses global fetch). No external dependencies.
 *
 * Env vars:
 *   GH_ORG    - organization login, e.g. "my-org"          (required)
 *   GH_TOKEN  - token with read:org + repo (or public_repo) (required)
 *   OUT_FILE  - output path for the SVG, default "./profile/org-stats.svg"
 */

const ORG = process.env.GH_ORG;
const TOKEN = process.env.GH_TOKEN;
const OUT_FILE = process.env.OUT_FILE || "./profile/org-stats.svg";

if (!ORG || !TOKEN) {
  console.error("Missing required env vars GH_ORG and/or GH_TOKEN");
  process.exit(1);
}

const GRAPHQL_URL = "https://api.github.com/graphql";

async function graphql(query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const REPO_PAGE_QUERY = `
  query OrgRepos($login: String!, $after: String) {
    organization(login: $login) {
      repositories(first: 50, after: $after, ownerAffiliations: [OWNER], isFork: false) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          stargazerCount
          forkCount
          issues(states: OPEN) { totalCount }
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }
`;

const MERGED_PR_QUERY = `
  query MergedPRs($q: String!) {
    search(query: $q, type: ISSUE, first: 0) {
      issueCount
    }
  }
`;

async function fetchAllRepos() {
  let after = null;
  let hasNextPage = true;
  const repos = [];

  while (hasNextPage) {
    const data = await graphql(REPO_PAGE_QUERY, { login: ORG, after });
    const conn = data.organization?.repositories;
    if (!conn) break;
    repos.push(...conn.nodes);
    hasNextPage = conn.pageInfo.hasNextPage;
    after = conn.pageInfo.endCursor;
  }
  return repos;
}

async function fetchMergedPRCount() {
  const data = await graphql(MERGED_PR_QUERY, {
    q: `org:${ORG} is:pr is:merged`,
  });
  return data.search.issueCount;
}

function aggregate(repos) {
  const totals = {
    repoCount: repos.length,
    stars: 0,
    forks: 0,
    openIssues: 0,
  };
  const languageBytes = new Map(); // name -> { size, color }

  for (const repo of repos) {
    totals.stars += repo.stargazerCount;
    totals.forks += repo.forkCount;
    totals.openIssues += repo.issues.totalCount;

    for (const edge of repo.languages.edges) {
      const key = edge.node.name;
      const prev = languageBytes.get(key) || { size: 0, color: edge.node.color || "#858585" };
      prev.size += edge.size;
      languageBytes.set(key, prev);
    }
  }

  const totalLangBytes = [...languageBytes.values()].reduce((a, b) => a + b.size, 0) || 1;
  const topLanguages = [...languageBytes.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5)
    .map(([name, { size, color }]) => ({
      name,
      color,
      pct: (size / totalLangBytes) * 100,
    }));

  return { totals, topLanguages };
}

// Simple cosmetic grade purely based on relative star/repo scale.
// Not meant to be a rigorous metric, just a nice visual accent.
function computeGrade(totals) {
  const score = Math.log10(totals.stars + 1) * 2 + Math.log10(totals.repoCount + 1);
  if (score >= 6) return "S";
  if (score >= 4.5) return "A+";
  if (score >= 3.5) return "A";
  if (score >= 2.5) return "B+";
  if (score >= 1.5) return "B";
  return "C";
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSvg({ org, totals, topLanguages, mergedPRs, grade }) {
  const width = 480;
  const rowH = 25;
  const statsStartY = 90;
  const stats = [
    { label: "Total Stars", value: totals.stars },
    { label: "Total Forks", value: totals.forks },
    { label: "Public Repos", value: totals.repoCount },
    { label: "Open Issues", value: totals.openIssues },
    { label: "Merged PRs", value: mergedPRs },
  ];

  const statsHeight = stats.length * rowH;
  const langBarY = statsStartY + statsHeight + 30;
  const height = langBarY + 60;

  const statRows = stats
    .map((s, i) => {
      const y = statsStartY + i * rowH;
      return `
        <g class="stat-row">
          <circle cx="18" cy="${y - 5}" r="5" fill="#4c71f2" />
          <text x="34" y="${y}" class="stat-label">${esc(s.label)}</text>
          <text x="${width - 30}" y="${y}" text-anchor="end" class="stat-value">${s.value.toLocaleString()}</text>
        </g>`;
    })
    .join("\n");

  let barX = 30;
  const barWidth = width - 60;
  const barY = langBarY + 10;
  const langSegments = topLanguages
    .map((l) => {
      const segW = (l.pct / 100) * barWidth;
      const rect = `<rect x="${barX}" y="${barY}" width="${segW.toFixed(2)}" height="10" fill="${l.color}" />`;
      barX += segW;
      return rect;
    })
    .join("\n");

  const langLegend = topLanguages
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 30 + col * 220;
      const y = barY + 30 + row * 22;
      return `
        <g>
          <circle cx="${x}" cy="${y - 4}" r="5" fill="${l.color}" />
          <text x="${x + 14}" y="${y}" class="lang-label">${esc(l.name)} ${l.pct.toFixed(1)}%</text>
        </g>`;
    })
    .join("\n");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(org)} organization GitHub stats">
  <style>
    .card { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
    .title { font-size: 20px; font-weight: 600; fill: #2f2f2f; }
    .stat-label { font-size: 13px; fill: #434d58; }
    .stat-value { font-size: 13px; font-weight: 600; fill: #2f2f2f; }
    .lang-label { font-size: 11px; fill: #434d58; }
    .grade-text { font-size: 22px; font-weight: 700; fill: #4c71f2; }
    .grade-caption { font-size: 10px; fill: #767676; }
  </style>
  <rect x="0.5" y="0.5" rx="8" width="${width - 1}" height="${height - 1}" fill="#fffefe" stroke="#e4e2e2" />
  <g class="card">
    <text x="30" y="42" class="title">${esc(org)} &middot; Organization Stats</text>

    <circle cx="${width - 60}" cy="46" r="26" fill="none" stroke="#e6e6e6" stroke-width="3" />
    <circle cx="${width - 60}" cy="46" r="26" fill="none" stroke="#4c71f2" stroke-width="3" stroke-dasharray="163" stroke-dashoffset="40" transform="rotate(-90 ${width - 60} 46)" />
    <text x="${width - 60}" y="52" text-anchor="middle" class="grade-text">${esc(grade)}</text>

    ${statRows}

    <text x="30" y="${langBarY - 5}" class="stat-label" style="font-weight:600">Top Languages</text>
    <rect x="30" y="${barY}" width="${barWidth}" height="10" rx="5" fill="#e9e9e9" />
    ${langSegments}
    ${langLegend}
  </g>
</svg>`;
}

async function main() {
  console.log(`Fetching repos for org "${ORG}"...`);
  const repos = await fetchAllRepos();
  console.log(`Found ${repos.length} repos. Fetching merged PR count...`);
  const mergedPRs = await fetchMergedPRCount();

  const { totals, topLanguages } = aggregate(repos);
  const grade = computeGrade(totals);

  const svg = renderSvg({ org: ORG, totals, topLanguages, mergedPRs, grade });

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, svg, "utf8");

  console.log(`Wrote ${OUT_FILE}`);
  console.log(totals);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
