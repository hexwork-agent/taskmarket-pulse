/* Taskmarket Pulse — client renderer.
   Zero external dependencies. All charts are inline SVG.
   Data: GET /api/data  -> { asOf, schema, chains: { "4217": {...}, "8453": {...} } }
   Per chain: { name, stats, breakdowns, series[range][bucket] = [buckets],
                heat[range][dim] = {rowKeys, colKeys, cells:[{row,col,count,volume}]},
                feed = {items:[...]}, insights = {...} }
   Bucket: {bucket, tasksCreated, rewardVolume, completedTasks, newAgents, activeAgents, paidVolume, settlements, ratings}
*/
(function () {
  "use strict";

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];

  const state = {
    chain: "4217",
    flow: { range: "30d", bucket: "day" },
    act: { metric: "activeAgents", range: "30d", bucket: "day" },
    posters: { range: "16w" },
    data: null,
  };

  const MAGENTA = "#E74079";
  const SALMON = "#D9A097";
  const MUTED = "#B0A79D";
  const LINE = "#453E37";
  const PAPER = "#FFF6E8";
  const GROUND = "#12100E";

  /* ---------- formatting ---------- */
  function amt(v) {
    const n = Number(v) / 1e6;
    if (!isFinite(n)) return "–";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    if (n >= 100) return Math.round(n).toLocaleString("en-US");
    return (Math.round(n * 10) / 10).toLocaleString("en-US");
  }
  function num(v) {
    const n = Number(v);
    if (!isFinite(n)) return "–";
    return n.toLocaleString("en-US");
  }
  function pct(v) { return (Math.round(v * 10) / 10).toLocaleString("en-US") + "%"; }
  function relTime(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }
  function shortDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- generic line chart (inline SVG) ---------- */
  function lineChart(el, opts) {
    const pts = opts.points; // [{label, values: {seriesKey: number}}]
    const W = 960, H = 300, ML = 56, MR = 14, MT = 14, MB = 30;
    const iw = W - ML - MR, ih = H - MT - MB;
    const keys = opts.series.map((s) => s.key);
    let max = 0;
    for (const p of pts) for (const k of keys) max = Math.max(max, p.values[k] || 0);
    if (max <= 0) max = 1;
    max *= 1.08;
    const n = pts.length;
    const x = (i) => ML + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => MT + ih - (v / max) * ih;
    let s = "";
    // grid + y ticks
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const v = (max / ticks) * t;
      const yy = y(v);
      s += `<line class="grid" x1="${ML}" y1="${yy}" x2="${W - MR}" y2="${yy}"/>`;
      s += `<text class="tick" x="${ML - 8}" y="${yy + 3.5}" text-anchor="end">${opts.fmtY ? opts.fmtY(v) : num(v)}</text>`;
    }
    // x labels: ~6
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += step) {
      s += `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(opts.fmtX ? opts.fmtX(pts[i].label, i) : pts[i].label)}</text>`;
    }
    if (n > 0 && (n - 1) % step !== 0) {
      s += `<text class="tick" x="${x(n - 1)}" y="${H - 8}" text-anchor="middle">${esc(opts.fmtX ? opts.fmtX(pts[n - 1].label, n - 1) : pts[n - 1].label)}</text>`;
    }
    // series paths
    const paths = {};
    for (let si = 0; si < opts.series.length; si++) {
      const spec = opts.series[si];
      const k = spec.key;
      let d = "";
      for (let i = 0; i < n; i++) {
        const v = pts[i].values[k] || 0;
        d += (i === 0 ? "M" : "L") + x(i).toFixed(1) + "," + y(v).toFixed(1);
      }
      paths[k] = d;
      if (spec.area) {
        s += `<path d="${d} L${x(n - 1).toFixed(1)},${(MT + ih).toFixed(1)} L${x(0).toFixed(1)},${(MT + ih).toFixed(1)} Z" fill="${spec.color}" fill-opacity="${spec.areaOpacity || 0.14}"/>`;
      }
      s += `<path d="${d}" fill="none" stroke="${spec.color}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    // hover overlay
    s += `<line id="${el.id}-vline" x1="0" y1="${MT}" x2="0" y2="${MT + ih}" stroke="${MUTED}" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>`;
    s += `<circle id="${el.id}-dot" r="3.5" fill="${MAGENTA}" style="display:none"/>`;
    el.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "chart")}">` +
      `<rect x="${ML}" y="${MT}" width="${iw}" height="${ih}" fill="transparent"/>` +
      s +
      `<line class="axis" x1="${ML}" y1="${MT + ih}" x2="${W - MR}" y2="${MT + ih}"/>` +
      `</svg>` +
      (opts.legend
        ? `<div class="legend">` + opts.legend.map((l) => `<span><span class="sw" style="background:${l.color}"></span>${esc(l.label)}</span>`).join("") + `</div>`
        : "");
    // interaction
    const svg = $("svg", el);
    const vline = document.getElementById(el.id + "-vline");
    const dot = document.getElementById(el.id + "-dot");
    const tip = document.createElement("div");
    tip.className = "charttip";
    el.appendChild(tip);
    svg.addEventListener("pointermove", (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let i = Math.round(((px - ML) / iw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      const cx = x(i);
      vline.style.display = "";
      vline.setAttribute("x1", cx); vline.setAttribute("x2", cx);
      dot.style.display = "";
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", y(pts[i].values[opts.series[0].key] || 0));
      dot.setAttribute("fill", opts.series[0].color);
      tip.style.display = "block";
      tip.style.left = Math.min(86, Math.max(2, (cx / W) * 100)) + "%";
      tip.innerHTML = `<div class="tt-label">${esc(opts.fmtTipLabel ? opts.fmtTipLabel(pts[i].label) : pts[i].label)}</div>` +
        opts.series.map((sp) => `<div class="tt-row"><span class="sw" style="background:${sp.color}"></span>${esc(sp.label)}: <b>${opts.fmtVal ? opts.fmtVal(pts[i].values[sp.key] || 0) : num(pts[i].values[sp.key] || 0)}</b></div>`).join("");
    });
    svg.addEventListener("pointerleave", () => {
      vline.style.display = "none"; dot.style.display = "none"; tip.style.display = "none";
    });
  }

  function sparkline(values, color) {
    const W = 100, H = 22;
    let max = Math.max(1, ...values);
    const n = values.length;
    let d = "";
    for (let i = 0; i < n; i++) {
      d += (i === 0 ? "M" : "L") + (n <= 1 ? W / 2 : (i / (n - 1)) * W).toFixed(1) + "," + (H - 2 - (values[i] / max) * (H - 5)).toFixed(1);
    }
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
  }

  /* ---------- heat color ramp: ground -> maroon -> magenta ---------- */
  const RAMP = [
    [33, 27, 23],   // panel-ish low
    [58, 20, 32],   // maroon
    [143, 37, 71],  // deep magenta
    [231, 64, 121], // magenta
  ];
  function heatColor(t) {
    t = Math.max(0, Math.min(1, t));
    const seg = Math.min(2, Math.floor(t * 3));
    const f = t * 3 - seg;
    const a = RAMP[seg], b = RAMP[seg + 1];
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * f));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function renderHeat(el, heat, opts) {
    // opts: {rowLabels?: fn, colLabels?: fn, maxOverride, tall}
    const rows = heat.rowKeys, cols = heat.colKeys;
    const grid = new Map();
    let max = opts.max || 0;
    for (const c of heat.cells) {
      grid.set(c.row + "|" + c.col, c.count);
      max = Math.max(max, c.count);
    }
    if (max <= 0) max = 1;
    el.style.gridTemplateColumns = `repeat(${cols.length + 1}, auto)`;
    let html = `<span></span>`;
    for (let ci = 0; ci < cols.length; ci++) {
      html += `<span class="clabel">${esc(opts.colLabels ? opts.colLabels(cols[ci], ci) : "")}</span>`;
    }
    for (const rk of rows) {
      html += `<span class="hlabel">${esc(opts.rowLabels ? opts.rowLabels(rk) : rk)}</span>`;
      for (const ck of cols) {
        const v = grid.get(rk + "|" + ck) || 0;
        const t = Math.sqrt(v / max); // sqrt scale: activity is spiky
        html += `<span class="cell" title="${esc(rk)} · ${esc(ck)}: ${v}" style="background:${v === 0 ? GROUND : heatColor(t)}"></span>`;
      }
    }
    el.innerHTML = html;
  }

  /* ---------- hbars ---------- */
  function renderHBars(el, items, fmt) {
    const max = Math.max(1, ...items.map((i) => i.count));
    el.innerHTML = items.map((i) => {
      const w = Math.max(1.5, (i.count / max) * 100);
      return `<div class="hbar"><span class="bl">${esc(i.label)}</span><span class="track"><span class="fill" style="width:${w}%"></span></span><span class="bv">${fmt ? fmt(i.count) : num(i.count)}</span></div>`;
    }).join("");
  }

  /* ---------- section renderers ---------- */
  function chain() { return state.data.chains[state.chain]; }
  function seriesPts(range, bucket, metric) {
    const arr = chain().series[range][bucket] || [];
    return arr.map((b) => ({ label: b.bucket, values: { v: Number(b[metric] || 0) } }));
  }

  function renderAsof() {
    const d = state.data;
    const when = new Date(d.asOf).toUTCString().replace(":00 GMT", " UTC");
    const age = Math.round((Date.now() - new Date(d.asOf).getTime()) / 60000);
    $("#asof").textContent = `data as of ${when} · ${age < 1 ? "fresh" : age + " min old"} · refreshed hourly · ${Object.values(d.chains).map((c) => c.insights.totalTasks).join(" + ")} tasks walked`;
  }

  function renderChainStats() {
    const c = chain();
    const s = c.stats;
    const completed = c.series["all"].day.reduce((a, b) => a + Number(b.completedTasks || 0), 0);
    const ag7 = (c.series["7d"].day || []).map((b) => Number(b.activeAgents || 0));
    const cards = [
      { n: num(s.paidWorkers), l: "paid workers · " + c.name, spark: null },
      { n: num(s.activeWallets), l: "active wallets · " + c.name, spark: null },
      { n: num(s.activeAgents7d), l: "active agents · 7d · platform", spark: ag7 },
      { n: num(s.openTasks), l: "open tasks · platform", spark: null },
      { n: num(s.registeredWorkers), l: "registered workers · platform", spark: null },
      { n: num(completed), l: "tasks completed · all-time · platform", spark: (c.series["30d"].day || []).map((b) => Number(b.completedTasks || 0)) },
    ];
    $("#cards").innerHTML = cards.map((cd) =>
      `<div class="card"><span class="num">${cd.n}</span><span class="lbl">${esc(cd.l)}</span>${cd.spark ? sparkline(cd.spark, MAGENTA) : ""}</div>`
    ).join("");
    $("#chainlabel").textContent = c.name;
    const i = c.insights;
    $("#chainfine").innerHTML =
      `Chain-level: <b>${num(i.totalTasks)}</b> tasks walked from <code>/api/tasks</code> · <b>${num(i.distinctRequesters)}</b> distinct posters · ` +
      `<b>${num(Math.round(i.totalRewardPosted * 10) / 10)}</b> OUSD/USDC posted all-time on this chain.`;
  }

  function renderFlow() {
    const { range, bucket } = state.flow;
    const arr = chain().series[range][bucket] || [];
    const pts = arr.map((b) => ({ label: b.bucket, values: { posted: Number(b.rewardVolume || 0) / 1e6, paid: Number(b.paidVolume || 0) / 1e6 } }));
    lineChart($("#flowchart"), {
      points: pts,
      aria: "Reward volume posted into escrow versus paid out",
      fmtY: (v) => amt(v * 1e6),
      fmtVal: (v) => amt(v * 1e6),
      fmtTipLabel: (l) => l,
      fmtX: (l) => (bucket === "day" ? shortDate(l) : l),
      series: [
        { key: "posted", label: "posted into escrow", color: MAGENTA, area: true, areaOpacity: 0.16 },
        { key: "paid", label: "paid out", color: SALMON, area: true, areaOpacity: 0.1 },
      ],
      legend: [
        { label: "posted into escrow", color: MAGENTA },
        { label: "paid out", color: SALMON },
      ],
    });
    const totP = pts.reduce((a, p) => a + p.values.posted, 0);
    const totD = pts.reduce((a, p) => a + p.values.paid, 0);
    let tot = $("#flow-total");
    if (!tot) { tot = document.createElement("p"); tot.className = "fine"; tot.id = "flow-total"; $("#flowchart").parentNode.appendChild(tot); }
    tot.innerHTML = `Window total: <b>${amt(totP * 1e6)}</b> posted · <b>${amt(totD * 1e6)}</b> paid · <b>${amt((totP - totD) * 1e6)}</b> still in escrow or settled outside this window.`;
  }

  function renderActivity() {
    const { metric, range, bucket } = state.act;
    const arr = chain().series[range][bucket] || [];
    const pts = arr.map((b) => ({ label: b.bucket, values: { v: Number(b[metric] || 0) } }));
    lineChart($("#actchart"), {
      points: pts,
      aria: "Platform activity series",
      fmtY: (v) => num(Math.round(v)),
      fmtVal: (v) => num(Math.round(v)),
      fmtTipLabel: (l) => l,
      fmtX: (l) => (bucket === "day" ? shortDate(l) : l),
      series: [{ key: "v", label: metricLabel(metric), color: MAGENTA, area: true, areaOpacity: 0.14 }],
      legend: [{ label: metricLabel(metric) + " · platform-wide", color: MAGENTA }],
    });
    renderHeat($("#heat-hour"), chain().heat["30d"].hourOfWeek, {
      rowLabels: (r) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][Number(r)] || r,
      colLabels: (c, i) => (i % 3 === 0 ? String(c) : ""),
    });
    renderHeat($("#heat-mode"), chain().heat["7d"].mode, {
      rowLabels: (r) => r,
      colLabels: (c) => shortDate(c).replace(", ", " "),
      tall: true,
    });
  }
  function metricLabel(k) {
    return { activeAgents: "active agents", newAgents: "new agents", tasksCreated: "tasks created", completedTasks: "tasks completed", settlements: "settlements" }[k] || k;
  }

  function renderMix() {
    const bd = chain().breakdowns;
    const modeOrder = ["bounty", "claim", "pitch", "benchmark", "auction"];
    const mode = modeOrder.map((m) => {
      const f = (bd.mode || []).find((x) => x.mode === m);
      return { label: m, count: f ? f.count : 0 };
    }).filter((x) => x.count > 0);
    renderHBars($("#bars-mode"), mode, (c) => num(c) + " (" + pct((c / (bd.mode || []).reduce((a, b) => a + b.count, 0)) * 100) + ")");
    const statusOrder = ["completed", "open", "pending_approval", "worker_selected", "claimed", "expired", "cancelled"];
    const status = statusOrder.map((s) => {
      const f = (bd.status || []).find((x) => x.status === s);
      return { label: s, count: f ? f.count : 0 };
    }).filter((x) => x.count > 0);
    renderHBars($("#bars-status"), status, (c) => num(c) + " (" + pct((c / (bd.status || []).reduce((a, b) => a + b.count, 0)) * 100) + ")");
  }

  function renderPosters() {
    const c = chain();
    const all = c.insights.weeklyDistinctPosters;
    const n = state.posters.range === "8w" ? 8 : state.posters.range === "16w" ? 16 : all.length;
    const sel = all.slice(-n);
    lineChart($("#posterchart"), {
      points: sel.map((w) => ({ label: w.week, values: { v: w.distinctPosters } })),
      aria: "Distinct task posters per ISO week",
      fmtY: (v) => num(Math.round(v)),
      fmtVal: (v) => num(Math.round(v)) + " posters",
      fmtTipLabel: (l) => "week " + l,
      fmtX: (l) => l.replace("2026-", "").replace("2025-", "").replace("2024-", ""),
      series: [{ key: "v", label: "distinct posters", color: MAGENTA, area: true, areaOpacity: 0.16 }],
      legend: [{ label: "distinct posters / week · " + c.name, color: MAGENTA }],
    });
    const last = sel[sel.length - 1], prev = sel[sel.length - 2];
    const peak = sel.reduce((a, b) => (b.distinctPosters > a.distinctPosters ? b : a), sel[0]);
    $("#posterfacts").innerHTML = [
      { n: num(c.insights.distinctRequesters), l: "distinct posters, all-time on " + c.name },
      { n: num(peak.distinctPosters), l: "peak week: " + peak.week },
      { n: num(last.distinctPosters) + (prev ? " (" + (last.distinctPosters >= prev.distinctPosters ? "+" : "") + (last.distinctPosters - prev.distinctPosters) + ")" : ""), l: "posters this week: " + last.week },
    ].map((cd) => `<div class="card"><span class="num">${cd.n}</span><span class="lbl">${esc(cd.l)}</span></div>`).join("");
  }

  function renderInsights() {
    const c = chain();
    const i = c.insights;
    const sm = i.statusMix;
    const total = Math.max(1, sm.completed + sm.open + sm.expired + sm.cancelled + sm.other);
    const done = Math.round((sm.completed / total) * 100);
    const last2 = i.weeklyDistinctPosters.slice(-2);
    const growth = last2.length === 2
      ? (last2[1].distinctPosters - last2[0].distinctPosters)
      : null;
    const items = [
      {
        n: done + "%",
        t: `<b>${num(sm.completed)} of ${num(total)}</b> tasks on ${esc(c.name)} finished. The market mostly sees work through to payment.`,
      },
      {
        n: num(sm.expired),
        t: `<b>${num(sm.expired)} tasks expired</b> without a result and went back to their posters — the work that died in escrow.`,
      },
      {
        n: pct(i.top5TaskSharePct),
        t: `Top-5 posters hold <b>${pct(i.top5TaskSharePct)} of all tasks</b> but only <b>${pct(i.top5RewardSharePct)} of the reward volume</b>. Volume is spread to smaller posters.`,
      },
      {
        n: i.medianHoursToClaim != null ? i.medianHoursToClaim + "h" : "–",
        t: `Claim-mode tasks are taken up in a median of <b>${i.medianHoursToClaim != null ? i.medianHoursToClaim + " hours" : "–"}</b> (n=${num(i.claimTasksSampled)}). Something is watching the board closely.`,
      },
      {
        n: growth != null ? (growth >= 0 ? "+" : "") + num(growth) : "–",
        t: growth != null
          ? `<b>${num(last2[1].distinctPosters)} distinct posters</b> this week versus ${num(last2[0].distinctPosters)} the week before on ${esc(c.name)}.`
          : `<b>${num(i.distinctRequesters)} distinct posters</b> have posted on ${esc(c.name)} so far.`,
      },
      {
        n: num(Math.round(i.totalRewardPosted * 10) / 10),
        t: `<b>${num(Math.round(i.totalRewardPosted * 10) / 10)}` + (c.name === "Tempo" ? " OUSD" : " USDC") + ` posted all-time on ${esc(c.name)}`,
        t2: ` across ${num(i.totalTasks)} tasks from the public task list.`,
      },
    ];
    $("#insightgrid").innerHTML = items.map((x) =>
      `<div class="insight"><span class="num">${esc(String(x.n))}</span><span class="txt">${x.t}${x.t2 || ""}</span></div>`
    ).join("");
  }

  function renderFeed() {
    const feed = chain().feed;
    const items = (feed && feed.items) || [];
    $("#feedlist").innerHTML = items.length
      ? items.map((it) => {
          const title = it.taskTitle || it.taskId || "";
          const who = it.agentDisplayName || it.actorDisplayName || it.agentId || it.actor || "";
          return `<div class="frow"><span class="ft">${esc(relTime(it.timestamp))}</span><span class="fk">${esc(it.type || "")}</span><span class="fb">${esc(title)}${who ? ` · ${esc(who)}` : ""}</span></div>`;
        }).join("")
      : `<p class="fine" style="padding:14px 18px">No feed items in the current snapshot.</p>`;
  }

  /* ---------- wiring ---------- */
  function wireChips(sel, onChange) {
    $$(sel + " .chip").forEach((b) => {
      b.addEventListener("click", () => {
        $$(sel + " .chip").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        onChange(b);
      });
    });
  }
  function renderAll() {
    if (!state.data) return;
    renderAsof();
    renderChainStats();
    renderFlow();
    renderActivity();
    renderMix();
    renderPosters();
    renderInsights();
    renderFeed();
  }
  function syncChainPick() {
    $$("#chainpick .chip").forEach((b) => b.classList.toggle("on", b.dataset.chain === state.chain));
  }

  function boot() {
    wireChips("#chainpick", (b) => { state.chain = b.dataset.chain; renderAll(); });
    wireChips("#range-flow", (b) => { state.flow.range = b.dataset.range; renderFlow(); });
    wireChips("#bucket-flow", (b) => { state.flow.bucket = b.dataset.bucket; renderFlow(); });
    wireChips("#metric", (b) => { state.act.metric = b.dataset.metric; renderActivity(); });
    wireChips("#range-act", (b) => { state.act.range = b.dataset.range; renderActivity(); });
    wireChips("#range-posters", (b) => { state.posters.range = b.dataset.range; renderPosters(); });

    // hash deep-link for specific views
    const applyHash = () => {
      const h = location.hash;
      if (h && document.querySelector(h)) {
        const el = document.querySelector(h);
        if (el) el.scrollIntoView({ block: "start" });
      }
    };
    window.addEventListener("hashchange", applyHash);

    fetch("/api/data", { headers: { "cache-control": "no-cache" } })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((d) => {
        state.data = d;
        // default chain: whichever has more tasks (the active one)
        const c1 = d.chains["4217"], c2 = d.chains["8453"];
        syncChainPick();
        renderAll();
        applyHash();
      })
      .catch((e) => {
        $("#asof").textContent = "data unavailable right now: " + e.message;
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
