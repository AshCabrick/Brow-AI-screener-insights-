import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Insights() {
  const [d, setD] = useState(null);
  useEffect(() => {
    const load = () => api.insights().then(setD);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!d) return <div className="empty">Loading insights…</div>;

  const total = d.breadth.advancing + d.breadth.declining + d.breadth.unchanged || 1;
  const List = ({ title, items }) => (
    <div className="panel">
      <h3>{title}</h3>
      {items.map((i) => (
        <div className="li" key={i.symbol}>
          <span><b>{i.symbol}</b> <small>₹{i.price}</small></span>
          <span className={i.change >= 0 ? "up" : "down"}>{i.change >= 0 ? "+" : ""}{i.change}%</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="insights">
      <div className="row-between">
        <h1>Insights</h1>
        <span className={"pill big " + d.sentiment.toLowerCase()}>Market Sentiment: {d.sentiment}</span>
      </div>

      <div className="panel">
        <h3>Market Breadth</h3>
        <div className="bar">
          <i style={{ width: (d.breadth.advancing / total) * 100 + "%", background: "#16a34a" }} />
          <i style={{ width: (d.breadth.unchanged / total) * 100 + "%", background: "#cbd5e1" }} />
          <i style={{ width: (d.breadth.declining / total) * 100 + "%", background: "#dc2626" }} />
        </div>
        <small>{d.breadth.advancing} advancing • {d.breadth.declining} declining • {d.breadth.unchanged} unchanged</small>
      </div>

      <div className="grid">
        <List title="Top Gainers" items={d.topGainers} />
        <List title="Top Losers" items={d.topLosers} />
        <List title="Volume Shockers" items={d.volumeShockers} />
        <div className="panel">
          <h3>Sector Performance</h3>
          {d.sectors.map((s) => (
            <div className="li" key={s.sector}>
              <span>{s.sector}</span>
              <span className={s.avgChange >= 0 ? "up" : "down"}>{s.avgChange >= 0 ? "+" : ""}{s.avgChange}%</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Regimes</h3>
          {Object.entries(d.regimes).map(([k, v]) => (
            <div className="li" key={k}><span>{k}</span><b>{v}</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}