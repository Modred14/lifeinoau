// components/admin/Frame.js — the console's chrome: sidebar, mobile drawer and the administrator gate.
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SquaresFour, Broadcast, UsersThree, Crown, Coins, ShieldWarning, GameController, Megaphone, ClipboardText, List, ArrowLeft } from "@phosphor-icons/react";
import NotFound from "@/components/NotFound";
import { get, useApi, Skeleton } from "./kit";
import "./admin.css";

const NAV = [
  ["/admin", "Overview", SquaresFour], ["/admin/online", "Online players", Broadcast], ["/admin/players", "All players", UsersThree], ["/admin/forbes", "Forbes OAU", Crown],
  ["/admin/economy", "Economy", Coins], ["/admin/moderation", "Moderation", ShieldWarning], ["/admin/game", "Game systems", GameController], ["/admin/notices", "Announcements", Megaphone], ["/admin/audit", "Audit log", ClipboardText],
];

export default function Frame({ children }) {
  const path = usePathname(), [open, setOpen] = useState(false), me = useApi("me"), reports = useApi("moderation/reports", {}, { every: 60000, skip: !me.data });
  useEffect(() => setOpen(false), [path]);
  useEffect(() => { document.title = "Admin · Life in OAU"; }, []);
  if (me.error && (me.error.status === 404 || me.error.status === 401)) return <NotFound />; // non-administrators are told nothing
  const here = (h) => (h === "/admin" ? path === "/admin" : path === h || path.startsWith(h + "/")), open_ = reports.data?.total ?? 0;
  return (
    <div className="adm" data-nav={open ? "open" : "closed"}>
      <div className="adm-top"><button className="btn ghost" onClick={() => setOpen(true)} aria-label="Open menu"><List size={20} /></button><b style={{ fontFamily: "var(--font-head)" }}>Life in OAU · Admin</b></div>
      <div className="adm-scrim" onClick={() => setOpen(false)} />
      <aside className="adm-side" aria-label="Admin navigation">
        <div className="adm-brand"><i>O</i><div>Life in OAU<small>Control room</small></div></div>
        <nav className="adm-nav">{NAV.map(([h, l, I]) => <Link key={h} href={h} aria-current={here(h) ? "page" : undefined}><I size={18} />{l}{h === "/admin/moderation" && open_ > 0 && <span className="cnt" aria-label={`${open_} open reports`}>{open_}</span>}</Link>)}</nav>
        <div className="adm-foot"><span>{me.data ? <>Signed in as <b style={{ color: "var(--text)" }}>{me.data.name}</b></> : "…"}</span><Link href="/home" className="mut" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><ArrowLeft size={14} />Back to the game</Link></div>
      </aside>
      <main className="adm-main" id="main">{me.data ? children : <div className="card"><Skeleton rows={6} /></div>}</main>
    </div>
  );
}
