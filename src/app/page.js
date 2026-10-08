// app/page.js
"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client";
import { Icon } from "@/components/Icon";

const CampusMap = dynamic(() => import("@/components/CampusMap"), { ssr: false });

export default function Home() {
  const router = useRouter(), [mode, setMode] = useState(null), [news, setNews] = useState(null), [show, setShow] = useState(false);
  const [f, setF] = useState({ email: "", password: "", isAdult: false }), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { call("/api/meta").then((r) => { if (!r.failed) setNews(r); }); }, []);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr("");
    const res = await call(mode === "signup" ? "/api/signup" : "/api/login", f);
    setBusy(false); res.failed ? setErr(res.error ?? "Something went wrong. Try again.") : router.push("/play");
  }
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
        {!mode ? (<>
          <h1 style={{ fontSize: "1.9rem" }}>Live your OAU story with real people.</h1>
          <p className="mut">Pick a look, get dealt a life, and see how far you go from your first lecture to your last.</p>
          <div className="row" style={{ marginTop: 12 }}><button type="button" className="go" onClick={() => setMode("signup")}>Sign up</button><button type="button" onClick={() => setMode("login")}>Log in</button></div>
          <p className="mut" style={{ marginTop: 12, fontSize: "0.85rem" }}>For players 18 and over. The campus map is stylised, not to scale.</p>
        </>) : (
          <form onSubmit={submit} noValidate>
            <div className="top"><h2>{mode === "signup" ? "Create your account" : "Welcome back"}</h2><button type="button" className="ghost" aria-label="Close" onClick={() => { setMode(null); setErr(""); }}><Icon name="close" /></button></div>
            <div className="tabs" role="tablist" style={{ margin: "12px 0" }}>{[["signup", "Create account"], ["login", "Log in"]].map(([m, l]) => <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => { setMode(m); setErr(""); }}>{l}</button>)}</div>
            <p><label>Email<input type="email" required autoComplete="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label></p>
            <p><label>Password
              <span style={{ position: "relative", display: "block" }}>
                <input type={show ? "text" : "password"} required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} style={{ paddingRight: 52 }} aria-describedby="pw-help" />
                <button type="button" className="ghost" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)} style={{ position: "absolute", right: 2, top: 12, width: 44, padding: 0, border: 0 }}><Icon name={show ? "eyeOff" : "eye"} /></button>
              </span></label>
              {mode === "signup" && <span id="pw-help" className="field-help">At least 8 characters.</span>}</p>
            {mode === "signup" && <label className="chk"><input type="checkbox" checked={f.isAdult} onChange={(e) => setF({ ...f, isAdult: e.target.checked })} /> I am 18 or older</label>}
            {err && <div className="field-err" role="alert">{err}</div>}
            <button className="go" style={{ width: "100%", marginTop: 12 }} disabled={busy || !f.email || f.password.length < 8 || (mode === "signup" && !f.isAdult)}>{busy ? "One moment..." : mode === "signup" ? "Start my life" : "Log in"}</button>
          </form>)}
      </div>
    </div>
  </>);
}
