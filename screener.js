import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";

const SIDEBAR = [
  ["explore", "Explore", "🔥"], ["live", "Live Market Scanner", "📡"], ["brow", "By BROW", "✳️"],
  ["following", "Following", "👥"], ["boosted", "Boosted", "🚀"], ["shared", "Shared With Me", "➕"],
];
const TABS = [
  ["all", "All Screeners", "🔍"], ["trending", "Trending Screeners", "⚡"], ["latest", "Latest Screeners", "⭐"],
  ["editors", "Editor's Choice", "🏅"], ["contributors", "Top Contributors", "🔼"],
];
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : n);

export default function Screeners() {
  const [side, setSide] = useState("explore");
  const [tab, setTab] = useState("all");
  const [list, setList] = useState([]);
  const [rows, setRows] = useState(null);
  const [title, setTitle] = useState("");
  const [modal, setModal] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    if (side === "live") return setRows(await api.live());
    setRows(null);
    setList(await api.screeners(side === "explore" ? tab : side === "saved" ? "saved" : side));
  }, [side, tab]);

  useEffect(() => { load(); const t = side === "live" ? setInterval(load, 4000) : null; return () => clearInterval(t); }, [load, side]);

  const boost = async (e, id) => { e.stopPropagation(); await api.act(id, "boost"); load(); };
  const openScreener = async (s) => setOpen(await api.run(s.id));

  return (
    <div className="layout">
      <aside className="side">
        <h2>🎯 Screeners</h2>
        {SIDEBAR.map(([k, label, icon]) => (
          <button key={k} className={"side-item " + (side === k ? "on" : "")} onClick={() => setSide(k)}>
            <span>{icon}</span>{label}
          </button>
        ))}
        <hr />
        <button className={"side-item " + (side === "saved" ? "on" : "")} onClick={() => setSide("saved")}>💾 My Saved Screeners</button>
      </aside>

      <main className="main">
        <div className="row-between">
          <h1>{side === "live" ? "Live Market Scanner" : "Explore"}</h1>
          <button className="primary" onClick={() => setModal(true)}>＋ Create Screener</button>
        </div>

        {side === "explore" && (
          <div className="tabs">
            {TABS.map(([k, label, icon]) => (
              <button key={k} className={"tab " + (tab === k ? "on" : "")} onClick={() => setTab(k)}>
                <span>{label}</span><i>{icon}</i>
              </button>
            ))}
          </div>
        )}

        {side === "live" ? (
          <ResultTable rows={rows || []} />
        ) : (
          <>
            <h3 className="sub">{TABS.find((t) => t[0] === tab)?.[1] ?? "Screeners"}</h3>
            {list.length === 0 && <div className="empty">No screeners here yet.</div>}
            {list.map((s) => (
              <div key={s.id} className="card" onClick={() => openScreener(s)}>
                <div className="icon">{s.editors ? "⬆️" : "₹"}</div>
                <div className="body">
                  <div className="ttl">{s.title}</div>
                  {s.description && <p>{s.description}</p>}
                  <small>{s.author} • {new Date(s.date).toLocaleDateString("en-IN", { month: "short", day: "2-digit", year: "numeric" })}</small>
                </div>
                <button className={"boost " + (s.boosted ? "on" : "")} onClick={(e) => boost(e, s.id)}>🚀 {fmt(s.boosts)}</button>
              </div>
            ))}
          </>
        )}
      </main>

      {open && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="row-between">
              <h2>{open.screener.title}</h2>
              <div>
                <button className="ghost" onClick={async () => { await api.act(open.screener.id, "save"); load(); }}>💾 Save</button>
                <button className="ghost" onClick={() => setOpen(null)}>✕</button>
              </div>
            </div>
            <ResultTable rows={open.results} />
          </div>
        </div>
      )}

      {modal && (
        <div className="overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Screener</h2>
            <input placeholder="Screener name" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input id="nlq" placeholder='Query, e.g. "large cap banking above 500"' />
            <button className="primary" onClick={async () => {
              await api.create({ title, query: document.getElementById("nlq").value });
              setModal(false); setTitle(""); setTab("latest"); setSide("explore"); load();
            }}>Create</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultTable({ rows }) {
  return (
    <table className="tbl">
      <thead><tr><th>Symbol</th><th>Price</th><th>Change %</th><th>Volume</th><th>PE</th><th>Regime</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.symbol}>
            <td><b>{r.symbol}</b><br /><small>{r.name}</small></td>
            <td>₹{r.price.toLocaleString("en-IN")}</td>
            <td className={r.change >= 0 ? "up" : "down"}>{r.change >= 0 ? "+" : ""}{r.change}%</td>
            <td>{(r.volume / 1e6).toFixed(2)}M</td>
            <td>{r.pe}</td>
            <td><span className="pill">{r.regime}</span></td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan="6" className="empty">No matches</td></tr>}
      </tbody>
    </table>
  );
}