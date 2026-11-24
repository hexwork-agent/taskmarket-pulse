// Netlify Function: GET /api/data
// Serves the latest Pulse data blob from Netlify Blobs. If the stored blob is
// missing or older than 55 minutes, refreshes it in place before responding
// (best-effort, with a guard so a slow API can't hang the request forever).
// Edge cache: 60s + stale-while-revalidate 1h, so hourly cron keeps it warm.

import { get, put } from "@netlify/blobs";
import { collectAll } from "../src/collect.mjs";

const KEY = "pulse/data.json";
const MAX_AGE_MS = 55 * 60 * 1000;

async function withTimeout(promise, ms, label) {
  return await Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timed out after " + ms + "ms")), ms)),
  ]);
}

export default async () => {
  let blob = await get(KEY);
  let age = blob ? Date.now() - blob.lastModified : Infinity;
  if (!blob || age > MAX_AGE_MS) {
    try {
      const fresh = await withTimeout(collectAll(), 24000, "collect");
      blob = await put(KEY, JSON.stringify(fresh));
    } catch (e) {
      if (!blob) return new Response("data unavailable and refresh failed: " + e.message, { status: 503 });
      // stale blob is better than none
    }
  }
  const text = await blob.text();
  return new Response(text, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=3600",
      "x-pulse-stored": new Date(blob.lastModified).toUTCString(),
    },
  });
};
