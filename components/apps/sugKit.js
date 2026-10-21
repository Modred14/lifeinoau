// components/apps/sugKit.js: small shared pieces for the SUG app screens (see components/apps/SugApp.js).
// Nothing here decides anything: every rule is enforced by the server. These only make the screens easy to build and consistent.
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client";
import { run, useResource } from "@/lib/gameStore";
import { serverTime } from "@/lib/serverClock";

/** The server's clock, re-read every `ms`. */
export function useNow(ms = 1000) {
  const [n, setN] = useState(() => serverTime());
  useEffect(() => { const t = setInterval(() => setN(serverTime()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

/** useResource, plus a quiet refresh every `every` ms while the screen is on (0 = no polling). */
export function useLive(path, every = 0) {
  const r = useResource(path);
  const { load } = r;
  useEffect(() => {
    if (!every) return;
    const t = setInterval(() => { if (!document.hidden) load(); }, every);
    return () => clearInterval(t);
  }, [every, load]);
  return r;
}

/**
 * One action against one of the SUG routes. Every request carries a fresh requestId, so a retry of the same tap can never act twice.
 * `reload` is called after a success so the screen shows what the server now says.
 */
export function useDo(path, reloads) {
  const router = useRouter();
  return useCallback(async (body, o = {}) => {
    const res = await run({
      key: o.key ?? `${path}:${body.action}`,
      router,
      sensitive: !!o.sensitive,
      pending: o.pending,
      ok: o.ok,
      sound: o.sound,
      request: () => call(path, { ...body, requestId: crypto.randomUUID() }),
      effects: [],
      then: o.then,
    });
    if (!res.failed) await Promise.all((Array.isArray(reloads) ? reloads : [reloads]).map((f) => f?.()));
    return res;
  }, [path, router, reloads]);
}

const two = (n) => String(n).padStart(2, "0");
/** "2d 04h 10m", "04h 10m 05s", "10m 05s": a countdown to `at`. */
export function left(at, now) {
  let s = Math.max(0, Math.floor((at - now) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return d ? `${d}d ${two(h)}h ${two(m)}m` : h ? `${two(h)}h ${two(m)}m ${two(s)}s` : `${two(m)}m ${two(s)}s`;
}
export function Countdown({ at, label }) {
  const now = useNow(1000);
  if (!at) return null;
  return <span className="sg-count" role="timer" aria-label={label}>{at <= now ? "now" : left(at, now)}</span>;
}

const fmt = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const when = (t) => (t ? fmt.format(new Date(t)) : "–");
export const nairaN = (n) => "₦" + Number(n).toLocaleString("en-NG");

/** A message box that is always readable (not a tiny red line): used for "why you can't" and for hints. */
export function Note({ tone = "info", title, children }) {
  return (
    <div className="sg-note" data-tone={tone} role={tone === "warn" ? "alert" : undefined}>
      {title ? <b>{title}</b> : null}
      <div>{children}</div>
    </div>
  );
}
export const Empty = ({ children }) => <p className="sg-empty">{children}</p>;
export function Section({ title, hint, children, aside }) {
  return (
    <section className="sg-sec">
      <header><h3>{title}</h3>{aside}</header>
      {hint ? <p className="sg-hint">{hint}</p> : null}
      {children}
    </section>
  );
}