// Taskmarket Pulse — data collector (ESM).
// Fetches the public Taskmarket API (no key needed) and produces one JSON blob.
// Runs as a Netlify scheduled function (hourly, 30s budget) and locally via
// `node src/collect.mjs`. All fetches parallelized (chains in parallel,
// intra-chain endpoint pool of 6) so a full collection lands well under 30s.
//
// Endpoints used (all under https://api.taskmarket.dev):
//   /api/market/stats?chainId=…
//   /api/stats/breakdowns?chainId=…
//   /api/stats/platform-time-series?chainId=…&range=7d|30d|90d|all&bucket=day|week
//   /api/stats/activity-heatmap?chainId=…&range=7d|30d|90d|all&dimension=mode|hourOfWeek
//   /api/stats/activity-feed?chainId=…&limit=20
//   /api/tasks?chainId=…&sort=newest&limit=100&cursor=…   (full walk, for distinct-poster + insight math)

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = "https://api.taskmarket.dev";
const CHAINS = [
  { id: 4217, name: "Tempo" },
  { id: 8453, name: "Base" },
];
const RANGES = ["7d", "30d", "90d", "all"];
const BUCKETS = ["day", "week"];
const HEAT_DIMS = ["mode", "hourOfWeek"];

async function getJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "taskmarket-pulse/1.0 (server-side)" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
    }
  }
  throw last;
}

// small concurrency pool
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function walkTasks(chainId) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    const url =
      BASE +
      "/api/tasks?chainId=" + chainId +
      "&sort=newest&limit=100" +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    const d = await getJson(url);
    const items = Array.isArray(d) ? d : d.items || d.tasks || [];
    out.push(...items);
    cursor = d && !Array.isArray(d) ? d.nextCursor || d.cursor : null;
    if (!cursor || items.length === 0) break;
  }
  return out;
}

function isoWeek(d) {
  // Monday-start ISO week label like 2026-W47
  const date = new Date(d);
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const week1 = new Date(date.getUTCFullYear(), 0, 4);
  const week = 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return date.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}

function computeInsights(tasks) {
  // Everything here is derived from the /api/tasks list itself.
  const byWeek = new Map();
  const byRequester = new Map();
  const modeStatus = { completed: 0, open: 0, expired: 0, cancelled: 0, other: 0 };
  const claimGaps = []; // hours from created to claimed, claim-mode tasks
  let totalReward = 0;

  for (const t of tasks) {
    const created = t.createdAt ? new Date(t.createdAt) : null;
    const week = created ? isoWeek(created) : null;
    const req = (t.requester || "").toLowerCase();
    const rewardNum = Number(t.reward || 0) / 1e6; // six-decimal base units

    if (week && req) {
      const w = byWeek.get(week) || new Set();
      w.add(req);
      byWeek.set(week, w);
    }
    if (req) {
      const r = byRequester.get(req) || { tasks: 0, reward: 0 };
      r.tasks += 1;
      r.reward += rewardNum;
      byRequester.set(req, r);
    }
    totalReward += rewardNum;

    switch (t.status) {
      case "completed": modeStatus.completed++; break;
      case "open": case "claimed": case "worker_selected": case "pending_approval": case "review":
        modeStatus.open++; break;
      case "expired": modeStatus.expired++; break;
      case "cancelled": modeStatus.cancelled++; break;
      default: modeStatus.other++;
    }
    if (t.mode === "claim" && t.createdAt && t.claimedAt) {
      const h = (new Date(t.claimedAt) - new Date(t.createdAt)) / 3600000;
      if (h >= 0 && h < 24 * 90) claimGaps.push(h);
    }
  }

  const weeks = [...byWeek.entries()].map(([w, set]) => ({ week: w, distinctPosters: set.size })).sort((a, b) => a.week.localeCompare(b.week));
  const posters = [...byRequester.entries()]
    .map(([addr, v]) => ({ requester: addr, tasks: v.tasks, reward: Math.round(v.reward * 100) / 100 }))
    .sort((a, b) => b.tasks - a.tasks || b.reward - a.reward);

  const n = tasks.length;
  const top5 = posters.slice(0, 5);
  const top5Share = n ? Math.round((top5.reduce((s, p) => s + p.tasks, 0) / n) * 1000) / 10 : 0;
  const top5RewardShare = totalReward ? Math.round((top5.reduce((s, p) => s + p.reward, 0) / totalReward) * 1000) / 10 : 0;

  claimGaps.sort((a, b) => a - b);
  const medianClaimGapH = claimGaps.length ? Math.round(claimGaps[Math.floor(claimGaps.length / 2)] * 10) / 10 : null;

  return {
    totalTasks: n,
    weeklyDistinctPosters: weeks,
    topPosters: top5.map((p) => ({ tasks: p.tasks, reward: p.reward })),
    top5TaskSharePct: top5Share,
    top5RewardSharePct: top5RewardShare,
    distinctRequesters: byRequester.size,
    statusMix: modeStatus,
    claimTasksSampled: claimGaps.length,
    medianHoursToClaim: medianClaimGapH,
    totalRewardPosted: Math.round(totalReward * 100) / 100,
  };
}

async function collectChain(chain) {
  const c = chain.id;
  const q = "?chainId=" + c;
  // round 1: independent endpoints + full task walk, in parallel
  const [stats, breakdowns, feed, tasks] = await Promise.all([
    getJson(BASE + "/api/market/stats" + q),
    getJson(BASE + "/api/stats/breakdowns" + q),
    getJson(BASE + "/api/stats/activity-feed" + q + "&limit=20"),
    walkTasks(c),
  ]);
  // round 2: time series + heatmaps through a bounded pool
  const endpoints = [];
  const series = {};
  for (const range of RANGES) {
    series[range] = {};
    for (const bucket of BUCKETS) {
      endpoints.push({ kind: "series", range, bucket, url: BASE + "/api/stats/platform-time-series" + q + "&range=" + range + "&bucket=" + bucket });
    }
  }
  const heat = {};
  for (const range of RANGES) {
    heat[range] = {};
    for (const dim of HEAT_DIMS) {
      endpoints.push({ kind: "heat", range, dim, url: BASE + "/api/stats/activity-heatmap" + q + "&range=" + range + "&dimension=" + dim });
    }
  }
  await pool(endpoints, 6, async (ep) => {
    const d = await getJson(ep.url);
    if (ep.kind === "series") series[ep.range][ep.bucket] = d;
    else heat[ep.range][ep.dim] = d;
  });
  return { name: chain.name, stats, breakdowns, series, heat, feed, insights: computeInsights(tasks) };
}

export async function collectAll() {
  const t0 = Date.now();
  const results = await Promise.all(CHAINS.map((ch) => collectChain(ch)));
  const chains = {};
  results.forEach((v, i) => { chains[CHAINS[i].id] = v; });
  const blob = { asOf: new Date().toISOString(), schema: 1, chains };
  blob._collectSeconds = Math.round((Date.now() - t0) / 100) / 10;
  return blob;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  collectAll()
    .then((blob) => {
      const out = "public/data.json";
      fs.mkdirSync("public", { recursive: true });
      fs.writeFileSync(out, JSON.stringify(blob));
      const kb = Math.round((fs.statSync(out).size / 1024) * 10) / 10;
      console.log("wrote", out, kb, "KB in", blob._collectSeconds, "s; tasks per chain:", Object.values(blob.chains).map((c) => c.insights.totalTasks).join(", "));
    })
    .catch((e) => { console.error("collect failed:", e); process.exit(1); });
}
