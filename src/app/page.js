// app/page.js
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client";

export default function Home() {
  const r = useRouter(), [mode, setMode] = useState("signup"), [f, setF] = useState({ email: "", password: "", isAdult: false });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr("");
    const res = await call(mode === "signup" ? "/api/signup" : "/api/login", f);
    setBusy(false); res.failed ? setErr(res.error ?? "Something went wrong.") : r.push("/play");
  }
  return (<>
    <h1>OAU Life</h1>
    <p className="mut">Your life. Your choices. Your OAU.</p>
    <div className="card"><p>Create a student, get a random start in life, and survive Ile-Ife. Study, hustle, party, call your parent, and stay out of Floor 0.</p></div>
    <form className="card" onSubmit={submit}>
      <div className="tabs" role="tablist">{["signup", "login"].map((m) => <button type="button" key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "signup" ? "Sign up" : "Log in"}</button>)}</div>
      <p><label>Email<input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label></p>
      <p><label>Password<input type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label></p>
      {mode === "signup" && <label className="chk"><input type="checkbox" checked={f.isAdult} onChange={(e) => setF({ ...f, isAdult: e.target.checked })} /> I am 18 or older</label>}
      {err && <div className="msg bad" role="alert">{err}</div>}
      <button className="go" style={{ width: "100%" }} disabled={busy || (mode === "signup" && !f.isAdult)}>{busy ? "Please wait" : mode === "signup" ? "Start my life" : "Log in"}</button>
    </form></>);
}
