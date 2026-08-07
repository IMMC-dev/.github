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

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const STAT_ICONS = {
  star: `<g transform="scale(0.5)">
         <path fill="#cc0000" d="M12 .25a.75.75 0 0 1 .673.418l3.058 6.197 6.839.994a.75.75 0 0 1 .415 1.279l-4.948 4.823 1.168 6.811a.751.751 0 0 1-1.088.791L12 18.347l-6.117 3.216a.75.75 0 0 1-1.088-.79l1.168-6.812-4.948-4.823a.75.75 0 0 1 .416-1.28l6.838-.993L11.328.668A.75.75 0 0 1 12 .25Zm0 2.445L9.44 7.882a.75.75 0 0 1-.565.41l-5.725.832 4.143 4.038a.748.748 0 0 1 .215.664l-.978 5.702 5.121-2.692a.75.75 0 0 1 .698 0l5.12 2.692-.977-5.702a.748.748 0 0 1 .215-.664l4.143-4.038-5.725-.831a.75.75 0 0 1-.565-.41L12 2.694Z"></path>
         </g>`,
  fork: `<g transform="scale(0.5)">
         <path fill="#cc0000" d="M8.75 19.25a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0ZM15 4.75a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0Zm-12.5 0a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0ZM5.75 6.5a1.75 1.75 0 1 0-.001-3.501A1.75 1.75 0 0 0 5.75 6.5ZM12 21a1.75 1.75 0 1 0-.001-3.501A1.75 1.75 0 0 0 12 21Zm6.25-14.5a1.75 1.75 0 1 0-.001-3.501A1.75 1.75 0 0 0 18.25 6.5Z"></path>
         <path fill="#cc0000" d="M6.5 7.75v1A2.25 2.25 0 0 0 8.75 11h6.5a2.25 2.25 0 0 0 2.25-2.25v-1H19v1a3.75 3.75 0 0 1-3.75 3.75h-6.5A3.75 3.75 0 0 1 5 8.75v-1Z"></path>
         <path fill="#cc0000" d="M11.25 16.25v-5h1.5v5h-1.5Z"></path>
         </g>`,
  repo: `<g transform="scale(0.5)">
         <path fill="#cc0000" d="M3 2.75A2.75 2.75 0 0 1 5.75 0h14.5a.75.75 0 0 1 .75.75v20.5a.75.75 0 0 1-.75.75h-6a.75.75 0 0 1 0-1.5h5.25v-4H6A1.5 1.5 0 0 0 4.5 18v.75c0 .716.43 1.334 1.05 1.605a.75.75 0 0 1-.6 1.374A3.251 3.251 0 0 1 3 18.75ZM19.5 1.5H5.75c-.69 0-1.25.56-1.25 1.25v12.651A2.989 2.989 0 0 1 6 15h13.5Z"></path>
         <path fill="#cc0000" d="M7 18.25a.25.25 0 0 1 .25-.25h5a.25.25 0 0 1 .25.25v5.01a.25.25 0 0 1-.397.201l-2.206-1.604a.25.25 0 0 0-.294 0L7.397 23.46a.25.25 0 0 1-.397-.2v-5.01Z"></path>
         </g>`,
  issue: `<g transform="scale(0.5)">
          <path fill="#cc0000" d="M12 1c6.075 0 11 4.925 11 11s-4.925 11-11 11S1 18.075 1 12 5.925 1 12 1ZM2.5 12a9.5 9.5 0 0 0 9.5 9.5 9.5 9.5 0 0 0 9.5-9.5A9.5 9.5 0 0 0 12 2.5 9.5 9.5 0 0 0 2.5 12Zm9.5 2a2 2 0 1 1-.001-3.999A2 2 0 0 1 12 14Z"></path>
          </g>`,
  pr: `<g transform="scale(0.5)">
       <path fill="#cc0000" d="M16 19.25a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0Zm-14.5 0a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0Zm0-14.5a3.25 3.25 0 1 1 6.5 0 3.25 3.25 0 0 1-6.5 0ZM4.75 3a1.75 1.75 0 1 0 .001 3.501A1.75 1.75 0 0 0 4.75 3Zm0 14.5a1.75 1.75 0 1 0 .001 3.501A1.75 1.75 0 0 0 4.75 17.5Zm14.5 0a1.75 1.75 0 1 0 .001 3.501 1.75 1.75 0 0 0-.001-3.501Z"></path>
       <path fill="#cc0000" d="M13.405 1.72a.75.75 0 0 1 0 1.06L12.185 4h4.065A3.75 3.75 0 0 1 20 7.75v8.75a.75.75 0 0 1-1.5 0V7.75a2.25 2.25 0 0 0-2.25-2.25h-4.064l1.22 1.22a.75.75 0 0 1-1.061 1.06l-2.5-2.5a.75.75 0 0 1 0-1.06l2.5-2.5a.75.75 0 0 1 1.06 0ZM4.75 7.25A.75.75 0 0 1 5.5 8v8A.75.75 0 0 1 4 16V8a.75.75 0 0 1 .75-.75Z"></path>
       </g>`,
};

function renderSvg({ org, totals, topLanguages, mergedPRs }) {
  const width = 480;
  const rowH = 25;
  const statsStartY = 30;
  const stats = [
    { icon: "star", label: "Total Stars", value: totals.stars },
    { icon: "fork", label: "Total Forks", value: totals.forks },
    { icon: "repo", label: "Repos", value: totals.repoCount },
    { icon: "issue", label: "Open Issues", value: totals.openIssues },
    { icon: "pr", label: "Merged PRs", value: mergedPRs },
  ];

  const statsHeight = stats.length * rowH;
  const langBarY = statsStartY + statsHeight + 30;

  const statRows = stats
    .map((s, i) => {
      const y = statsStartY + i * rowH;
      return `
        <g>
          <g transform="translate(12, ${y - 11})">${STAT_ICONS[s.icon]}</g>
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

  const legendStartY = barY + 30;
  const legendRows = Math.max(1, Math.ceil(topLanguages.length / 2));
  const langLegend = topLanguages
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 30 + col * 220;
      const y = legendStartY + row * 22;
      return `
        <g>
          <circle cx="${x}" cy="${y - 4}" r="5" fill="${l.color}" />
          <text x="${x + 14}" y="${y}" class="lang-label">${esc(l.name)} ${l.pct.toFixed(1)}%</text>
        </g>`;
    })
    .join("\n");

  const height = legendStartY + (legendRows - 1) * 22 + 24;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(org)} organization GitHub stats">
  <style>
    .card { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
    .stat-label { font-size: 13px; fill: #434d58; }
    .stat-value { font-size: 13px; font-weight: 600; fill: #2f2f2f; }
    .lang-label { font-size: 11px; fill: #434d58; }
  </style>
  <rect x="0.5" y="0.5" rx="8" width="${width - 1}" height="${height - 1}" fill="#fffefe" stroke="#e4e2e2" />
  <g class="card">
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

  const svg = renderSvg({ org: ORG, totals, topLanguages, mergedPRs });

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
