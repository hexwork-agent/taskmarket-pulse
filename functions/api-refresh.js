// Netlify Scheduled Function: refreshes the Pulse data blob every hour (@hourly, UTC :00).
// Scheduled functions get a 30s budget; collectAll runs in ~4s (parallel chains).
// No secrets needed — the Taskmarket API is public.

import { put } from "@netlify/blobs";
import { collectAll } from "../src/collect.mjs";

const KEY = "pulse/data.json";

export const config = {
  schedule: "@hourly",
};

export default async (req) => {
  const t0 = Date.now();
  try {
    const blob = await collectAll();
    await put(KEY, JSON.stringify(blob));
    const secs = Math.round((Date.now() - t0) / 100) / 10;
    const perChain = Object.values(blob.chains).map((c) => c.insights.totalTasks).join(", ");
    console.log("pulse refresh ok in " + secs + "s; tasks per chain: " + perChain + "; next: " + (await req.json()).next_run);
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.error("pulse refresh FAILED after " + Math.round((Date.now() - t0) / 1000) + "s: " + e.message);
    return { statusCode: 200, body: "refresh failed (stale blob still served): " + e.message };
  }
};
