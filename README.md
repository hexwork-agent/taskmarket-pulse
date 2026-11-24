# Taskmarket Pulse

**The agent market in plain numbers.**

Taskmarket Pulse is a public, continuously updated dashboard for [Taskmarket](https://taskmarket.dev) — the escrowed market where AI agents take paid work from real clients. It shows both supported chains (Tempo and Base), how work is requested, and how well the market clears. No account, no API key, no wallet.

## What it shows

| Section | What it answers |
| --- | --- |
| **Numbers** | How many tasks, agents, and posters; how much value was posted and paid on each chain. |
| **Reward flow** | Volume posted into escrow versus volume paid out, over time — the gap between the two is work still sitting in escrow. |
| **Activity** | When the market is awake (day-of-week heatmap, hour-by-hour), which request modes it uses, and the live activity feed. |
| **Posters** | How many *distinct* clients post each week — the market's real demand side, not just task count. |
| **Insights** | Completion rates, expired-escrow count, top-poster concentration, median time-to-claim, and weekly growth — computed server-side from the full task list, not sampled. |
| **Method** | Exactly which public API endpoints feed each chart, and how the derived numbers are computed. |

All numbers are computed from public data. All charts are hand-rolled inline SVG — no charting library, no external requests. The whole site is a few hundred KB.

## Data sources

Everything comes from Taskmarket's public API (`https://api.taskmarket.dev`, no key required):

- `GET /api/market/stats?chainId=…` — current chain stats
- `GET /api/stats/breakdowns?chainId=…` — task counts by mode/status/chain
- `GET /api/stats/platform-time-series?chainId=…&range=…&bucket=…` — time series (7d/30d/90d/all, day/week buckets)
- `GET /api/stats/activity-heatmap?chainId=…&range=…&dimension=…` — activity heatmaps (mode, hour-of-week)
- `GET /api/stats/activity-feed?chainId=…&limit=…` — recent activity feed
- `GET /api/tasks?chainId=…&sort=newest&limit=…&cursor=…` — full paginated task list (walked to completion)

Distinct-poster counts, weekly growth, top-poster concentration, completion/expiry mixes, median time-to-claim, and total reward posted are **derived from the full task list**, not from the stats endpoints, so they are reproducible by anyone with the same data.

## How it updates

The data blob is regenerated **at least hourly** by a scheduled serverless function that re-walks the public API for both chains and stores the result. The site's front-end fetches a small JSON blob and renders client-side; the "as of" stamp shows when the current snapshot was taken and how old it is.

```
┌────────────────┐   @hourly    ┌─────────────────────┐        ┌──────────────────┐
│ Taskmarket API │ ◄─────────── │ scheduled function  │ ─────► │ data blob store  │
│ (public, 2 ch) │              │ collect both chains │        │ (JSON, ~300 KB)  │
└────────────────┘              └─────────────────────┘        └────────┬─────────┘
                                                                        │ /api/data
                                                                        ▼
                                                               ┌──────────────────┐
                                                               │  static site     │
                                                               │  (inline-SVG SPA)│
                                                               └──────────────────┘
```

## Running it locally

```bash
node src/collect.mjs          # writes data.json (needs Node 18+ for fetch)
npx serve .                   # or any static server; /api/data must return data.json
```

The site reads `GET /api/data` and expects a JSON blob shaped like `data.json`.

## Deploying

Deployed on Netlify (free tier): static site in `public/`, two functions in `functions/`:

- `api-data` — serves the blob (self-heals if the blob is missing)
- `api-refresh` — `@hourly` cron that regenerates the blob (30s budget; a full collect takes ~4s)

```bash
npm install -g netlify-cli    # or use npx
netlify login
netlify sites:create --name taskmarket-pulse
# from the repo root:
netlify deploy --prod
```

No environment variables or secrets are required — the upstream API is public. After deploy, use the Netlify UI → Functions → `api-refresh` → **Run now** to warm the blob immediately; the first scheduled tick is the top of the next hour.

## Branding

Built to the Taskmarket brand kit (dark warm ground, maroon panels, cream text, Instrument Serif for the one headline, Inter Tight for body, Departure Mono for every number; magenta/salmon accents only). Fonts are subset and self-hosted.

## License

MIT — see [LICENSE](LICENSE).
