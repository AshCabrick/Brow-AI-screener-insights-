import express from "express";
import fs from "fs";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

/* =====================================================================
   1. MARKET DATA (simulated; swap for a real NSE/BSE feed later)
   ===================================================================== */
const base = [
  ["HYUNDAI", "Hyundai Motor India Ltd", "Auto", "large", 1943.3, 1867, 1.1e6, 28],
  ["ADANIPORTS", "Adani Port & SEZ Ltd", "Infrastructure", "large", 1821.5, 1761.3, 2.3e6, 26],
  ["POWERGRID", "Power Grid Corp. Ltd.", "Power", "large", 259.9, 251.4, 2.6e6, 18],
  ["ADANIENT", "Adani Enterprises Ltd", "Metals & Mining", "large", 2544.5, 2479.6, 7.0e5, 62],
  ["PIIND", "PI Industries Ltd", "Chemicals", "mid", 2108.4, 2054.9, 3.67e4, 33],
  ["HDFCBANK", "HDFC Bank Ltd", "Banking", "large", 1002.2, 998.1, 9.1e6, 19],
  ["ICICIBANK", "ICICI Bank Ltd", "Banking", "large", 1388.6, 1379.0, 6.4e6, 18],
  ["TCS", "Tata Consultancy Services", "IT", "large", 3120.0, 3141.5, 1.9e6, 24],
  ["INFY", "Infosys Ltd", "IT", "large", 1498.8, 1510.2, 4.2e6, 23],
  ["RELIANCE", "Reliance Industries Ltd", "Energy", "large", 1431.9, 1422.0, 5.5e6, 25],
  ["SUNPHARMA", "Sun Pharmaceutical", "Pharma", "large", 1702.3, 1689.9, 1.4e6, 35],
  ["TATAMOTORS", "Tata Motors Ltd", "Auto", "large", 681.4, 690.1, 8.8e6, 11],
  ["IDFCFIRSTB", "IDFC First Bank", "Banking", "mid", 74.2, 72.9, 1.2e7, 21],
  ["POLYCAB", "Polycab India Ltd", "Capital Goods", "mid", 7180.0, 7010.5, 2.1e5, 42],
  ["TATAELXSI", "Tata Elxsi Ltd", "IT", "mid", 5890.0, 5955.0, 1.1e5, 48],
];
const instruments = base.map(([symbol, name, sector, cap, price, prevClose, volume, pe]) => ({
  symbol, name, sector, cap, price, prevClose, volume, pe,
  avgVolume: volume / (1 + Math.random()),
}));

setInterval(() => {
  for (const i of instruments) {
    i.price = +(i.price * (1 + (Math.random() - 0.5) * 0.004)).toFixed(2);
    i.volume += Math.floor(Math.random() * 5000);
  }
}, 3000);

const enrich = (i) => {
  const change = +(((i.price - i.prevClose) / i.prevClose) * 100).toFixed(2);
  const regime = Math.abs(change) >= 3 ? "VOLATILE" : change >= 1 ? "BULLISH" : change <= -1 ? "BEARISH" : "RANGE";
  return { ...i, change, regime };
};

/* =====================================================================
   2. SCREENER ENGINE + NATURAL-LANGUAGE PARSER
   ===================================================================== */
function runFilters(list, f = {}) {
  return list.map(enrich).filter((i) =>
    (!f.cap || i.cap === f.cap) &&
    (!f.sector || i.sector.toLowerCase() === String(f.sector).toLowerCase()) &&
    (f.minPrice == null || i.price >= f.minPrice) &&
    (f.maxPrice == null || i.price <= f.maxPrice) &&
    (f.minChange == null || i.change >= f.minChange) &&
    (f.maxChange == null || i.change <= f.maxChange) &&
    (f.minVolume == null || i.volume >= f.minVolume) &&
    (f.maxPE == null || i.pe <= f.maxPE) &&
    (!f.regime || i.regime === String(f.regime).toUpperCase())
  );
}

function parseQuery(text = "") {
  const t = text.toLowerCase(), f = {};
  if (/large\s?cap/.test(t)) f.cap = "large";
  else if (/mid\s?cap/.test(t)) f.cap = "mid";
  for (const s of ["banking", "it", "auto", "pharma", "energy", "power", "chemicals", "infrastructure"]) {
    if (new RegExp("\\b" + s + "\\b").test(t)) f.sector = s === "it" ? "IT" : s[0].toUpperCase() + s.slice(1);
  }
  let m;
  if ((m = t.match(/(?:above|over|>)\s*(\d+(?:\.\d+)?)/))) f.minPrice = +m[1];
  if ((m = t.match(/(?:below|under|<)\s*(\d+(?:\.\d+)?)/))) f.maxPrice = +m[1];
  if (/gainers|momentum|breakout/.test(t)) f.minChange = 1;
  if (/losers|oversold/.test(t)) f.maxChange = -1;
  if (/high volume/.test(t)) f.minVolume = 1e6;
  return f;
}

/* =====================================================================
   3. INSIGHTS ENGINE
   ===================================================================== */
function buildInsights() {
  const all = instruments.map(enrich);
  const advancing = all.filter((i) => i.change > 0).length;
  const declining = all.filter((i) => i.change < 0).length;
  const map = {};
  all.forEach((i) => {
    const s = (map[i.sector] ??= { sector: i.sector, total: 0, count: 0 });
    s.total += i.change; s.count++;
  });
  const sectors = Object.values(map)
    .map((s) => ({ sector: s.sector, avgChange: +(s.total / s.count).toFixed(2), count: s.count }))
    .sort((a, b) => b.avgChange - a.avgChange);
  const sorted = [...all].sort((a, b) => b.change - a.change);
  const ratio = advancing / Math.max(1, advancing + declining);
  return {
    updatedAt: new Date().toISOString(),
    sentiment: ratio > 0.6 ? "Bullish" : ratio < 0.4 ? "Bearish" : "Neutral",
    breadth: { advancing, declining, unchanged: all.length - advancing - declining },
    topGainers: sorted.slice(0, 5),
    topLosers: sorted.slice(-5).reverse(),
    volumeShockers: all.filter((i) => i.volume > i.avgVolume * 1.5).slice(0, 5),
    sectors,
    regimes: all.reduce((a, i) => ((a[i.regime] = (a[i.regime] || 0) + 1), a), {}),
  };
}

/* =====================================================================
   4. SCREENER STORE (in memory; use a database for production)
   ===================================================================== */
const screeners = [
  { id: "s1", title: "MOMENTUM STOCKS", description: "Stocks up 1%+ on healthy volume.", author: "@parimalx8f16a64", date: "2025-11-07", boosts: 2600, weekBoosts: 120, editors: false, filters: { minChange: 1, minVolume: 500000 } },
  { id: "s2", title: "Nifty 50", description: "Benchmark index of the top 50 large-cap companies listed on NSE.", author: "@browai", date: "2024-07-01", boosts: 746, weekBoosts: 40, editors: true, filters: { cap: "large" } },
  { id: "s3", title: "BLASTING MOMENTUM", description: "Strong movers above 2%.", author: "@akhileshx40468b7", date: "2024-10-11", boosts: 1400, weekBoosts: 75, editors: false, filters: { minChange: 2 } },
  { id: "s4", title: "Near Breakout Stocks in Uptrend", description: "PE below 30 with minimum 1 lac volume.", author: "@ashishthakure6eecfd4", date: "2025-04-08", boosts: 697, weekBoosts: 22, editors: true, filters: { maxPE: 30, minVolume: 100000, minChange: 0.5 } },
  { id: "s5", title: "Oversold Banking Names", description: "Banking stocks trading lower on the day.", author: "@browai", date: "2026-10-20", boosts: 310, weekBoosts: 150, editors: false, filters: { sector: "Banking", maxChange: -0.5 } },
];
const users = new Map();
const getUser = (id) => {
  if (!users.has(id)) users.set(id, { following: new Set(), boosted: new Set(), saved: new Set(), shared: new Set(["s5"]) });
  return users.get(id);
};
const uid = (req) => req.header("x-user-id") || "demo";
const decorate = (s, u) => ({ ...s, boosted: u.boosted.has(s.id), saved: u.saved.has(s.id), following: u.following.has(s.author) });

/* =====================================================================
   5. API ROUTES
   ===================================================================== */
app.get("/api/health", (_, res) => res.json({ ok: true, time: Date.now() }));

app.get("/api/screeners", (req, res) => {
  const u = getUser(uid(req));
  const { tab = "all", q = "" } = req.query;
  let list = [...screeners];
  switch (tab) {
    case "trending": list.sort((a, b) => b.weekBoosts - a.weekBoosts); break;
    case "latest": list.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
    case "editors": list = list.filter((s) => s.editors); break;
    case "contributors": {
      const tot = {};
      screeners.forEach((s) => (tot[s.author] = (tot[s.author] || 0) + s.boosts));
      list.sort((a, b) => tot[b.author] - tot[a.author]);
      break;
    }
    case "brow": list = list.filter((s) => s.author === "@browai"); break;
    case "following": list = list.filter((s) => u.following.has(s.author)); break;
    case "boosted": list = list.filter((s) => u.boosted.has(s.id)); break;
    case "shared": list = list.filter((s) => u.shared.has(s.id)); break;
    case "saved": list = list.filter((s) => u.saved.has(s.id)); break;
  }
  if (q) list = list.filter((s) => (s.title + " " + s.description).toLowerCase().includes(String(q).toLowerCase()));
  res.json(list.map((s) => decorate(s, u)));
});

app.post("/api/screeners", (req, res) => {
  const { title, description = "", query = "", filters = {} } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  const s = {
    id: "s" + Date.now(), title, description, author: "@" + uid(req),
    date: new Date().toISOString().slice(0, 10), boosts: 0, weekBoosts: 0, editors: false,
    filters: { ...parseQuery(query), ...filters },
  };
  screeners.unshift(s);
  res.status(201).json(decorate(s, getUser(uid(req))));
});

const toggle = (key, pick) => (req, res) => {
  const s = screeners.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  const u = getUser(uid(req)), set = u[key], k = pick(s), on = !set.has(k);
  on ? set.add(k) : set.delete(k);
  if (key === "boosted") { s.boosts += on ? 1 : -1; s.weekBoosts += on ? 1 : -1; }
  res.json(decorate(s, u));
};
app.post("/api/screeners/:id/boost", toggle("boosted", (s) => s.id));
app.post("/api/screeners/:id/save", toggle("saved", (s) => s.id));
app.post("/api/screeners/:id/follow", toggle("following", (s) => s.author));

app.get("/api/screeners/:id/run", (req, res) => {
  const s = screeners.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json({ screener: s, results: runFilters(instruments, s.filters) });
});

app.get("/api/scan", (req, res) => {
  const filters = parseQuery(String(req.query.q || ""));
  res.json({ filters, results: runFilters(instruments, filters) });
});

app.get("/api/live-scanner", (_, res) => res.json(instruments.map(enrich).sort((a, b) => b.change - a.change)));
app.get("/api/insights", (_, res) => res.json(buildInsights()));

/* =====================================================================
   6. SERVE THE FRONTEND (embedded at the bottom of this same file)
   ===================================================================== */
const OPEN = "/*<<" + "HTML", CLOSE = "HTML" + ">>*" + "/";
const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
const PAGE = src.slice(src.indexOf(OPEN) + OPEN.length, src.lastIndexOf(CLOSE));
app.get("/", (_, res) => res.type("html").send(PAGE));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("BROW AI running at http://localhost:" + PORT));

/*<<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BROW AI</title>
<style>
:root { --blue:#1d6bf3; --bg:#f6f8fb; --line:#e5e9f0; --text:#1f2937; --mute:#6b7280; }
* { box-sizing:border-box; }
body { margin:0; font-family:Inter,system-ui,sans-serif; background:var(--bg); color:var(--text); }
button { font:inherit; cursor:pointer; }
.topbar { display:flex; align-items:center; gap:24px; padding:12px 32px; background:#fff; border-bottom:1px solid var(--line); position:sticky; top:0; z-index:5; }
.brand { display:flex; align-items:center; gap:10px; font-size:20px; font-weight:700; background:#050b1a; color:#fff; padding:6px 14px; border-radius:12px; }
.brand b { color:#22d3ee; }
.topbar nav { display:flex; gap:6px; }
.topbar nav button { background:none; border:0; padding:8px 14px; font-weight:600; color:var(--mute); border-radius:8px; }
.topbar nav button.active, .topbar nav button:hover { color:var(--blue); background:#eef4ff; }
.search { margin-left:auto; width:320px; padding:10px 14px; border:1px solid var(--line); border-radius:12px; background:#f9fafb; font:inherit; }
.status { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--mute); white-space:nowrap; }
.dot { width:9px; height:9px; border-radius:50%; background:#dc2626; }
.dot.on { background:#16a34a; box-shadow:0 0 0 3px #dcfce7; }
.avatar { width:38px; height:38px; border-radius:50%; background:var(--blue); color:#fff; display:grid; place-items:center; font-weight:700; }
.layout { display:grid; grid-template-columns:310px 1fr; gap:24px; padding:28px 32px; max-width:1500px; margin:0 auto; }
.side h2 { margin:0 0 18px; font-size:22px; }
.side-item { width:100%; display:flex; gap:12px; align-items:center; text-align:left; padding:16px; margin-bottom:10px; background:#fff; border:1px solid var(--line); border-radius:10px; font-size:16px; }
.side-item.on { background:#eef4ff; border-color:#9dbcf7; color:var(--blue); font-weight:600; }
.side hr { border:0; border-top:1px solid var(--line); margin:22px 60px; }
.row-between { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
h1 { font-size:26px; font-weight:500; margin:0 0 20px; }
.primary { background:var(--blue); color:#fff; border:0; padding:12px 22px; border-radius:8px; font-size:16px; }
.primary:disabled { opacity:.6; }
.ghost { border:1px solid var(--line); font-size:14px; padding:6px 12px; border-radius:8px; background:#fff; }
.ghost.on { background:#eef4ff; color:var(--blue); border-color:#9dbcf7; }
.tabs { display:flex; gap:18px; margin-bottom:24px; flex-wrap:wrap; }
.tab { flex:1; min-width:170px; display:flex; justify-content:space-between; align-items:center; text-align:left; padding:20px 16px; background:#fff; border:1px solid var(--line); border-radius:10px; font-size:17px; }
.tab i { font-style:normal; font-size:30px; }
.tab.on { background:#eef4ff; border-color:#a9c4f7; }
.sub { font-weight:500; font-size:19px; margin:10px 0 14px; }
.card { display:flex; align-items:center; gap:18px; padding:22px; background:#fff; border:1px solid var(--line); border-radius:10px; margin-bottom:16px; cursor:pointer; transition:box-shadow .15s; }
.card:hover { box-shadow:0 4px 18px rgba(20,60,140,.08); }
.card .icon { width:48px; height:48px; border-radius:50%; background:#e0f2f1; display:grid; place-items:center; font-size:20px; flex:none; }
.card .body { flex:1; min-width:0; }
.card .ttl { font-size:19px; font-weight:500; }
.card p { margin:6px 0; color:#4b5563; }
.card small { color:var(--mute); }
.actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
.boost { background:none; border:0; font-size:17px; color:#555; padding:8px 14px; border-radius:20px; }
.boost.on { background:#eef4ff; color:var(--blue); }
.overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); display:grid; place-items:center; z-index:20; }
.modal { background:#fff; padding:26px; border-radius:14px; width:460px; max-width:94vw; display:flex; flex-direction:column; gap:12px; }
.modal.wide { width:min(980px,94vw); max-height:86vh; overflow:auto; display:block; }
.modal input { padding:12px; border:1px solid var(--line); border-radius:8px; font:inherit; }
.tbl { width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; border:1px solid var(--line); }
.tbl th { text-align:left; font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:var(--mute); padding:12px 14px; background:#fafbfc; }
.tbl td { padding:12px 14px; border-top:1px solid var(--line); }
.up { color:#16a34a; font-weight:600; } .down { color:#dc2626; font-weight:600; }
.pill { display:inline-block; padding:4px 10px; border:1px solid var(--line); border-radius:20px; font-size:12px; background:#fff; }
.pill.big { font-size:14px; padding:8px 16px; }
.pill.bullish { background:#dcfce7; color:#166534; } .pill.bearish { background:#fee2e2; color:#991b1b; } .pill.neutral { background:#f1f5f9; }
.pill.filter { background:#eef4ff; border-color:#c7dafb; color:var(--blue); margin:0 6px 6px 0; }
.ai, .insights { max-width:1300px; margin:0 auto; padding:28px 32px; }
.ai-box { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; margin-bottom:20px; }
.ai-row { display:flex; gap:12px; }
.ai-row input { flex:1; padding:14px; border:1px solid var(--line); border-radius:10px; font:inherit; font-size:16px; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
.chip { background:#f1f5f9; border:1px solid var(--line); padding:7px 14px; border-radius:20px; font-size:14px; }
.chip:hover { background:#eef4ff; color:var(--blue); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:18px; margin-top:18px; }
.panel { background:#fff; border:1px solid var(--line); border-radius:12px; padding:20px; }
.panel h3 { margin:0 0 14px; font-weight:600; }
.li { display:flex; justify-content:space-between; padding:9px 0; border-top:1px solid var(--line); }
.li:first-of-type { border-top:0; }
.bar { display:flex; height:14px; border-radius:8px; overflow:hidden; margin-bottom:10px; }
.empty { text-align:center; padding:40px; color:var(--mute); }
.err { background:#fee2e2; color:#991b1b; padding:12px 16px; border-radius:8px; margin:16px 32px; }
.toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#111827; color:#fff; padding:10px 18px; border-radius:10px; z-index:30; font-size:14px; }
@media (max-width:900px){ .layout{grid-template-columns:1fr;} .search{display:none;} .ai-row{flex-direction:column;} }
</style>
</head>
<body>
<header class="topbar">
  <div class="brand" id="logo"></div>
  <nav id="nav"></nav>
  <input class="search" id="search" placeholder="Search screeners" />
  <div class="status"><span class="dot" id="dot"></span><span id="stxt">Connecting...</span></div>
  <div class="avatar">A</div>
</header>
<div id="err"></div>
<div id="view"></div>
<div id="toast"></div>

<script>
(() => {
  const API = "/api"; // same server, so no CORS or port issues

  let USER = "demo";
  try {
    USER = localStorage.getItem("brow_uid") || "user" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("brow_uid", USER);
  } catch (_) {}

  const call = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { "Content-Type": "application/json", "x-user-id": USER } });
    if (!r.ok) throw new Error((await r.text()) || r.statusText);
    return r.json();
  };
  const api = {
    health: () => call("/health"),
    screeners: (tab, q) => call("/screeners?tab=" + encodeURIComponent(tab) + "&q=" + encodeURIComponent(q || "")),
    create: (b) => call("/screeners", { method: "POST", body: JSON.stringify(b) }),
    act: (id, action) => call("/screeners/" + id + "/" + action, { method: "POST" }),
    run: (id) => call("/screeners/" + id + "/run"),
    scan: (q) => call("/scan?q=" + encodeURIComponent(q)),
    live: () => call("/live-scanner"),
    insights: () => call("/insights"),
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : n);
  const sign = (n) => (n >= 0 ? "+" : "") + n;
  const cls = (n) => (n >= 0 ? "up" : "down");
  const dateFmt = (d) => new Date(d).toLocaleDateString("en-IN", { month: "short", day: "2-digit", year: "numeric" });
  const timeFmt = (d) => new Date(d).toLocaleTimeString("en-IN");
  let toastTimer;
  const toast = (m) => {
    $("toast").innerHTML = '<div class="toast">' + esc(m) + "</div>";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").innerHTML = ""), 2200);
  };

  const NAV = ["Home", "Screeners", "Insights"];
  const SIDEBAR = [
    ["explore", "Explore", "🔥"], ["live", "Live Market Scanner", "📡"], ["brow", "By BROW", "✳️"],
    ["following", "Following", "👥"], ["boosted", "Boosted", "🚀"], ["shared", "Shared With Me", "➕"],
  ];
  const TABS = [
    ["all", "All Screeners", "🔍"], ["trending", "Trending Screeners", "⚡"], ["latest", "Latest Screeners", "⭐"],
    ["editors", "Editor's Choice", "🏅"], ["contributors", "Top Contributors", "🔼"],
  ];
  const CHIPS = ["Top Gainers", "Top Losers", "High Volume", "Breakouts", "Oversold", "Momentum",
                 "large cap banking above 500", "mid cap IT", "pharma under 2000"];
  const EMPTY_MSG = {
    following: "You are not following anyone yet. Tap Follow on a screener.",
    boosted: "You have not boosted any screeners yet.",
    saved: "No saved screeners yet. Tap Save on a screener.",
    shared: "Nothing has been shared with you yet.",
    brow: "No BROW screeners yet.",
  };

  const LOGO = '<svg width="36" height="36" viewBox="0 0 100 100" fill="none"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00F0FF"/><stop offset="1" stop-color="#0050FF"/></linearGradient></defs><g stroke="url(#lg)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M30 14 H60 a20 20 0 0 1 0 40 H38"/><path d="M36 25 H58 a9 9 0 0 1 0 18 H42"/><path d="M36 56 H62 a20 20 0 0 1 0 40 H30"/><path d="M34 68 H58 a8 8 0 0 1 0 16 H40"/></g><g fill="url(#lg)"><circle cx="20" cy="15" r="5"/><circle cx="22" cy="38" r="5"/><circle cx="20" cy="50" r="5"/><circle cx="26" cy="60" r="5"/><circle cx="22" cy="72" r="5"/><circle cx="20" cy="86" r="5"/><circle cx="28" cy="96" r="5"/></g></svg><span>BROW <b>AI</b></span>';

  const S = { page: "Home", side: "explore", tab: "all", q: "", list: [], rows: [], insights: null,
              loading: false, open: null, modal: false, aiQuery: "", scan: null, scanning: false };
  let timer = null, debounce = null;

  function setOnline(v) {
    $("dot").className = "dot" + (v ? " on" : "");
    $("stxt").textContent = v ? "Server online" : "Server offline";
  }

  async function load(silent) {
    if (!silent) { S.loading = true; render(); }
    try {
      if (S.page === "Screeners") {
        if (S.side === "live") S.rows = await api.live();
        else S.list = await api.screeners(S.side === "explore" ? S.tab : S.side, S.q);
      } else if (S.page === "Insights") {
        S.insights = await api.insights();
      }
      setOnline(true);
      $("err").innerHTML = "";
    } catch (e) {
      setOnline(false);
      $("err").innerHTML = '<div class="err">Cannot reach the server. Make sure it is running. Retrying...</div>';
    }
    S.loading = false;
    render();
  }

  async function pingHealth() { try { await api.health(); setOnline(true); } catch { setOnline(false); } }

  function schedule() {
    clearInterval(timer);
    if (S.page === "Insights") timer = setInterval(() => load(true), 5000);
    else if (S.page === "Screeners" && S.side === "live") timer = setInterval(() => load(true), 4000);
    else timer = setInterval(pingHealth, 10000);
  }
  function go() { schedule(); load(); renderNav(); }

  async function runScan(q) {
    q = (q || "").trim();
    if (!q) return toast("Type a query first");
    S.aiQuery = q; S.scanning = true; render();
    try { S.scan = Object.assign({ q: q }, await api.scan(q)); setOnline(true); }
    catch { setOnline(false); toast("Scan failed. Is the server running?"); }
    S.scanning = false; render();
  }

  function resultTable(rows) {
    return '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Symbol</th><th>Sector</th><th>Price</th><th>Change %</th><th>Volume</th><th>PE</th><th>Regime</th></tr></thead><tbody>' +
      rows.map((r) => "<tr><td><b>" + esc(r.symbol) + "</b><br><small>" + esc(r.name) + "</small></td><td>" + esc(r.sector) +
        "</td><td>₹" + Number(r.price).toLocaleString("en-IN") + '</td><td class="' + cls(r.change) + '">' + sign(r.change) +
        "%</td><td>" + (r.volume / 1e6).toFixed(2) + "M</td><td>" + r.pe + '</td><td><span class="pill">' + esc(r.regime) + "</span></td></tr>").join("") +
      (rows.length === 0 ? '<tr><td colspan="7" class="empty">No matches</td></tr>' : "") + "</tbody></table></div>";
  }

  function homeView() {
    const sc = S.scan, filters = sc ? Object.entries(sc.filters || {}) : [];
    return '<div class="ai"><h1>AI Screener</h1><div class="ai-box"><div class="ai-row">' +
      '<input id="ai-input" value="' + esc(S.aiQuery) + '" placeholder="Search symbol or query, e.g. large cap banking above 500" />' +
      '<button class="primary" data-a="scan" ' + (S.scanning ? "disabled" : "") + ">" + (S.scanning ? "Scanning..." : "Run Scan") + "</button></div>" +
      '<div class="chips">' + CHIPS.map((c) => '<button class="chip" data-a="chip" data-v="' + esc(c) + '">' + esc(c) + "</button>").join("") + "</div></div>" +
      (sc ? '<div class="row-between" style="margin-bottom:12px"><div><b>' + sc.results.length + "</b> instruments matched &ldquo;" + esc(sc.q) +
        '&rdquo;</div><button class="ghost" data-a="savescan">🔖 Save as screener</button></div><div style="margin-bottom:10px">' +
        (filters.length ? filters.map((kv) => '<span class="pill filter">' + esc(kv[0]) + ": " + esc(kv[1]) + "</span>").join("")
          : '<span class="pill">No filters detected, showing everything</span>') + "</div>" + resultTable(sc.results)
        : '<div class="empty">Run a scan or tap a chip above to get started.</div>') + "</div>";
  }

  function screenersView() {
    const sideHtml = SIDEBAR.map((x) => '<button class="side-item ' + (S.side === x[0] ? "on" : "") + '" data-a="side" data-v="' + x[0] + '"><span>' + x[2] + "</span>" + x[1] + "</button>").join("");
    const tabsHtml = S.side === "explore" ? '<div class="tabs">' + TABS.map((x) => '<button class="tab ' + (S.tab === x[0] ? "on" : "") + '" data-a="tab" data-v="' + x[0] + '"><span>' + x[1] + "</span><i>" + x[2] + "</i></button>").join("") + "</div>" : "";

    let content;
    if (S.side === "live") {
      content = '<h3 class="sub">Live prices <small style="color:var(--mute);font-weight:400">refreshes every 4s</small></h3>' + resultTable(S.rows);
    } else {
      const sub = S.side === "explore" ? (TABS.find((t) => t[0] === S.tab) || [])[1]
        : (SIDEBAR.find((x) => x[0] === S.side) || ["", "My Saved Screeners"])[1];
      content = '<h3 class="sub">' + esc(sub) + "</h3>" +
        (S.loading && S.list.length === 0 ? '<div class="empty">Loading...</div>' : "") +
        (!S.loading && S.list.length === 0 ? '<div class="empty">' + esc(S.q ? "No screeners match your search." : EMPTY_MSG[S.side] || "No screeners here yet.") + "</div>" : "") +
        S.list.map((s) => '<div class="card" data-a="open" data-id="' + s.id + '"><div class="icon">' + (s.editors ? "⬆️" : "₹") +
          '</div><div class="body"><div class="ttl">' + esc(s.title) + "</div>" + (s.description ? "<p>" + esc(s.description) + "</p>" : "") +
          "<small>" + esc(s.author) + " • " + dateFmt(s.date) + '</small></div><div class="actions">' +
          '<button class="ghost ' + (s.following ? "on" : "") + '" data-a="follow" data-id="' + s.id + '">' + (s.following ? "✓ Following" : "＋ Follow") + "</button>" +
          '<button class="ghost ' + (s.saved ? "on" : "") + '" data-a="save" data-id="' + s.id + '">' + (s.saved ? "🔖 Saved" : "🔖 Save") + "</button>" +
          '<button class="boost ' + (s.boosted ? "on" : "") + '" data-a="boost" data-id="' + s.id + '">🚀 ' + fmt(s.boosts) + "</button></div></div>").join("");
    }

    const openModal = S.open ? '<div class="overlay" data-a="closeoverlay"><div class="modal wide"><div class="row-between" style="margin-bottom:12px"><div><h2 style="margin:0">' +
      esc(S.open.screener.title) + '</h2><small style="color:var(--mute)">' + S.open.results.length + ' matching instruments</small></div><div class="actions">' +
      '<button class="ghost" data-a="save" data-id="' + S.open.screener.id + '">🔖 Save</button><button class="ghost" data-a="closeopen">✕ Close</button></div></div>' +
      '<div style="margin-bottom:10px">' + Object.entries(S.open.screener.filters || {}).map((kv) => '<span class="pill filter">' + esc(kv[0]) + ": " + esc(kv[1]) + "</span>").join("") +
      "</div>" + resultTable(S.open.results) + "</div></div>" : "";

    const createModal = S.modal ? '<div class="overlay" data-a="closeoverlay"><div class="modal"><h2 style="margin:0">Create Screener</h2>' +
      '<input id="c-title" placeholder="Screener name" /><input id="c-desc" placeholder="Description (optional)" />' +
      '<input id="c-query" placeholder="Query, e.g. large cap banking above 500" /><button class="primary" data-a="create">Create</button></div></div>' : "";

    return '<div class="layout"><aside class="side"><h2>🎯 Screeners</h2>' + sideHtml + "<hr>" +
      '<button class="side-item ' + (S.side === "saved" ? "on" : "") + '" data-a="side" data-v="saved"><span>💾</span>My Saved Screeners</button></aside>' +
      '<main class="main"><div class="row-between"><h1>' + (S.side === "live" ? "Live Market Scanner" : "Explore") +
      '</h1><button class="primary" data-a="newmodal">＋ Create Screener</button></div>' + tabsHtml + content + "</main>" + openModal + createModal + "</div>";
  }

  function insightsView() {
    const d = S.insights;
    if (!d) return '<div class="empty">' + (S.loading ? "Loading insights..." : "No data yet.") + "</div>";
    const total = d.breadth.advancing + d.breadth.declining + d.breadth.unchanged || 1;
    const list = (title, items) => '<div class="panel"><h3>' + title + "</h3>" + (items.length ? items.map((i) =>
      '<div class="li"><span><b>' + esc(i.symbol) + "</b> <small>₹" + i.price + '</small></span><span class="' + cls(i.change) + '">' + sign(i.change) + "%</span></div>").join("")
      : '<div class="empty" style="padding:12px">None right now</div>') + "</div>";
    return '<div class="insights"><div class="row-between"><h1>Insights</h1><div class="actions"><small style="color:var(--mute)">Updated ' + timeFmt(d.updatedAt) +
      ' · auto-refresh 5s</small><span class="pill big ' + d.sentiment.toLowerCase() + '">Market Sentiment: ' + esc(d.sentiment) + "</span></div></div>" +
      '<div class="panel"><h3>Market Breadth</h3><div class="bar"><i style="width:' + (d.breadth.advancing / total) * 100 + '%;background:#16a34a"></i><i style="width:' +
      (d.breadth.unchanged / total) * 100 + '%;background:#cbd5e1"></i><i style="width:' + (d.breadth.declining / total) * 100 + '%;background:#dc2626"></i></div><small>' +
      d.breadth.advancing + " advancing • " + d.breadth.declining + " declining • " + d.breadth.unchanged + " unchanged</small></div>" +
      '<div class="grid">' + list("Top Gainers", d.topGainers) + list("Top Losers", d.topLosers) + list("Volume Shockers", d.volumeShockers) +
      '<div class="panel"><h3>Sector Performance</h3>' + d.sectors.map((s) => '<div class="li"><span>' + esc(s.sector) + ' <small style="color:var(--mute)">(' + s.count +
        ')</small></span><span class="' + cls(s.avgChange) + '">' + sign(s.avgChange) + "%</span></div>").join("") + "</div>" +
      '<div class="panel"><h3>Regimes</h3>' + Object.entries(d.regimes).map((kv) => '<div class="li"><span>' + esc(kv[0]) + "</span><b>" + kv[1] + "</b></div>").join("") + "</div></div></div>";
  }

  function renderNav() {
    $("nav").innerHTML = NAV.map((n) => '<button class="' + (S.page === n ? "active" : "") + '" data-a="nav" data-v="' + n + '">' + n + "</button>").join("");
    $("search").style.visibility = S.page === "Screeners" ? "visible" : "hidden";
  }

  function render() {
    const keep = {};
    ["c-title", "c-desc", "c-query", "ai-input"].forEach((id) => { const el = $(id); if (el) keep[id] = el.value; });
    const focusId = document.activeElement && document.activeElement.id;
    $("view").innerHTML = S.page === "Home" ? homeView() : S.page === "Screeners" ? screenersView() : insightsView();
    Object.keys(keep).forEach((id) => { if ($(id)) $(id).value = keep[id]; });
    if (focusId && keep[focusId] !== undefined && $(focusId)) $(focusId).focus();
  }

  async function refreshAfterAction(id) {
    await load(true);
    if (S.open && S.open.screener.id === id) S.open = await api.run(id);
    render();
  }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-a]");
    if (!el) return;
    const a = el.dataset.a, v = el.dataset.v, id = el.dataset.id;
    try {
      switch (a) {
        case "nav": S.page = v; S.open = null; S.modal = false; go(); break;
        case "side": S.side = v; go(); break;
        case "tab": S.tab = v; go(); break;
        case "boost": { const u = await api.act(id, "boost"); toast(u.boosted ? "Boosted 🚀" : "Boost removed"); await refreshAfterAction(id); break; }
        case "save": { const u = await api.act(id, "save"); toast(u.saved ? "Saved" : "Removed from saved"); await refreshAfterAction(id); break; }
        case "follow": { const u = await api.act(id, "follow"); toast(u.following ? "Following " + u.author : "Unfollowed " + u.author); await refreshAfterAction(id); break; }
        case "open": S.open = await api.run(id); render(); break;
        case "closeopen": S.open = null; render(); break;
        case "closeoverlay": if (e.target === el) { S.open = null; S.modal = false; render(); } break;
        case "newmodal": S.modal = true; render(); $("c-title").focus(); break;
        case "create": {
          const title = $("c-title").value.trim();
          if (!title) { toast("Please enter a screener name"); break; }
          await api.create({ title: title, description: $("c-desc").value, query: $("c-query").value });
          S.modal = false; S.side = "explore"; S.tab = "latest"; S.q = ""; $("search").value = "";
          toast("Screener created"); go(); break;
        }
        case "scan": runScan($("ai-input").value); break;
        case "chip": S.aiQuery = v; runScan(v); break;
        case "savescan": {
          const title = prompt("Name for this screener:", S.scan.q);
          if (!title) break;
          await api.create({ title: title, query: S.scan.q });
          toast("Saved as a new screener. See Screeners > Explore > Latest."); break;
        }
      }
    } catch (err) { setOnline(false); toast("Request failed: " + err.message); }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.id === "ai-input" && e.key === "Enter") runScan(e.target.value);
    if (e.target.id === "c-query" && e.key === "Enter") document.querySelector('[data-a="create"]').click();
    if (e.key === "Escape" && (S.open || S.modal)) { S.open = null; S.modal = false; render(); }
  });

  $("search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      S.q = e.target.value.trim();
      if (S.page === "Screeners" && S.side !== "live") load(true);
    }, 300);
  });

  $("logo").innerHTML = LOGO;
  renderNav(); render(); schedule(); pingHealth();
})();
</script>
</body>
</html>
HTML>>*/