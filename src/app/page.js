// src/app/page.js
"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { call } from "@/lib/client";
import AuthModal from "@/components/AuthModal";

const CampusMap = dynamic(() => import("@/components/CampusMap"), { ssr: false });

export default function Home() {
  const [mode, setMode] = useState(null), [news, setNews] = useState(null);
  useEffect(() => { call("/api/meta").then((r) => { if (!r.failed) setNews(r); }); }, []);

  return (<>
    <div className="mapwrap"><CampusMap interactive={false} pins={false} autoRotate view={{ x: 0, z: 22, dist: 175, az: 0.55, pol: 1.0 }} /></div>
    <header className="hud">
      <span className="brand">life<i>in</i>oau</span>
      {news && <><span className="sep" aria-hidden="true" /><span className="meta num">Game week {news.week} · {news.headline}</span></>}
      <span className="grow" />
      <button type="button" className="ghost" onClick={() => setMode("login")}>Log in</button>
    </header>
    <div className="authwrap">
      <div className="card">
        <h1 style={{ fontSize: "1.9rem" }}>Live your OAU story with real people.</h1>
        <p className="mut">Pick a look, get dealt a life, and see how far you go from your first lecture to your last.</p>
        <div className="row" style={{ marginTop: 12 }}><button type="button" className="go" onClick={() => setMode("signup")}>Sign up</button><button type="button" onClick={() => setMode("login")}>Log in</button></div>
        <p className="mut" style={{ marginTop: 12, fontSize: "0.85rem" }}>For players 18 and over. The campus map is stylised, not to scale.</p>
      </div>
    </div>
    {mode && <AuthModal initialMode={mode} onClose={() => setMode(null)} />}
  </>);
}