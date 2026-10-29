import { useState } from "react";
import Logo from "./components/Logo.jsx";
import Screeners from "./pages/Screeners.jsx";
import Insights from "./pages/Insights.jsx";

const NAV = ["Home", "News", "Screeners", "Insights"];

export default function App() {
  const [page, setPage] = useState("Screeners");
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo /><span>BROW <b>AI</b></span></div>
        <nav>
          {NAV.map((n) => (
            <button key={n} className={page === n ? "active" : ""} onClick={() => setPage(n)}>{n}</button>
          ))}
        </nav>
        <input className="search" placeholder="Search for stocks" />
        <div className="avatar">A</div>
      </header>
      {page === "Screeners" && <Screeners />}
      {page === "Insights" && <Insights />}
      {(page === "Home" || page === "News") && <div className="empty">{page} coming soon</div>}
    </div>
  );
}