"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { configureWorldClock } from "@campuslife/shared/clock";
import { game } from "@/lib/gameStore";
import "@campus/globals.css";
import "@campus/game-ui.css";
import "./oau-campus.css";
const Campus = dynamic(() => import("@campus/components/GameShell").then((m) => m.GameShell), { ssr: false });
export default function OauCampus() {
  const [data, setData] = useState(null), [error, setError] = useState(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    fetch("/api/campus/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: ac.signal, cache: "no-store" }).then(async (r) => {
      const value = await r.json();
      if (!r.ok) throw new Error(value.error === "signed_out" ? "Sign in to OAU Life to enter campus." : value.error);
      configureWorldClock(value.clock.epoch, value.clock.week);
      setData(value);
    }).catch((e) => { if (!ac.signal.aborted) setError(e.message || "Campus could not connect."); });
    const refresh = () => { void game.refresh(); };
    window.addEventListener("oau:refresh", refresh);
    return () => { ac.abort(); window.removeEventListener("oau:refresh", refresh); };
  }, [attempt]);
  return <div className="campus-world" data-campus-world>
    {error ? <div className="oau-campus-error" role="alert"><h1>Campus could not connect</h1><p>{error}</p><button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button><Link href="/home">Return home</Link></div>
      : data ? <Campus student={data.student} /> : <div className="oau-campus-error" role="status">Joining OAU campus…</div>}
  </div>;
}
