// app/relationship/page.js
"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client";

const GIFTS = [["small", "Small gift", "₦5,000"], ["medium", "Nice gift", "₦20,000"], ["big", "Big gift", "₦50,000"]];

export default function Relationship() {
  const router = useRouter(), [d, setD] = useState(null), [msg, setMsg] = useState(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await call("/api/relationship"); if (r.status === 401) return router.push("/"); r.failed ? setMsg({ bad: true, text: r.error }) : setD(r); }, [router]);
  useEffect(() => { load(); }, [load]);

  async function go(path, body) {
    if (busy) return; setBusy(true); setMsg(null);
    const r = await call(path, { ...body, requestId: crypto.randomUUID() }); setBusy(false);
    r.failed ? setMsg({ bad: true, text: r.error }) : r.duplicate ? setMsg({ text: "Already done." }) : setMsg({ text: r.note ?? "Done." });
    load();
  }
  const act = (action, extra) => go("/api/relationship", { action, ...extra });
  if (!d) return <p className="mut">{msg?.text ?? "Loading..."}</p>;
  const c = d.current, pct = c ? Math.min(100, Math.round((c.affection / (c.nextNeeded ?? 100)) * 100)) : 0;
  return (<>
    <div className="top"><h2>Relationships</h2><a href="/play"><button>Back to game</button></a></div>
    {msg && <div className={"msg " + (msg.bad ? "bad" : "ok")} role="status">{msg.text}</div>}

    {d.pregnancy && <div className="card" role="alert"><h2>🚨 A big decision</h2>
      <p>{d.partnerIsPregnant ? "Your partner says she is pregnant." : "You think you might be pregnant."} You have <b>{d.pregnancy.weeksLeft}</b> game week(s) to decide. If you wait too long, life decides for you, and that has consequences.</p>
      <div className="row"><button className="go" disabled={busy} onClick={() => go("/api/pregnancy", { choice: "keep" })}>Keep the baby<br /><span className="mut">₦150,000 now, then ₦10,000 a week</span></button>
        <button disabled={busy} onClick={() => go("/api/pregnancy", { choice: "end" })}>End the pregnancy<br /><span className="mut">₦500,000, one time</span></button></div>
      <p className="mut">These are fictional game mechanics, not advice and not OAU rules.</p></div>}

    {!c && <div className="card"><b>Meet someone</b>
      {d.reconcile && <p>You and <b>{d.reconcile.npcName}</b> split recently. <button disabled={busy} onClick={() => act("reconcile")}>Get back together (₦10,000 gift)</button></p>}
      <div className="row" style={{ marginTop: 8 }}>{d.candidates.map((p) => <button key={p.slot} disabled={busy} onClick={() => act("start", { slot: p.slot })}>{p.name}<br /><span className="mut">{p.trait}</span></button>)}</div>
      <p className="mut">New faces every game week.</p></div>}

    {c && <>
      <div className="card"><div className="top"><h2>{c.npcName}</h2><span className="cash">{c.label}</span></div>
        <p className="mut">{c.trait} · affection {c.affection}{c.nextNeeded ? ` · ${c.nextNeeded} needed for ${c.nextLabel}` : " · you made it"}</p>
        {c.nextNeeded && <div className="bar" aria-hidden="true"><i style={{ width: pct + "%" }} /></div>}
        <p className="mut">Affection fades a little each week you don't make time.</p>
        {c.canAdvance && <button className="go" style={{ width: "100%" }} disabled={busy} onClick={() => act("advance")}>Take it to the next level: {c.nextLabel}</button>}</div>
      <div className="card"><b>Spend time</b><div className="row" style={{ marginTop: 8 }}>
        <button disabled={busy} onClick={() => act("chat")}>Chat<br /><span className="mut">5 energy</span></button>
        <button disabled={busy} onClick={() => act("flirt")}>Flirt<br /><span className="mut">8 energy · risky</span></button>
        <button disabled={busy || c.stage === "STRANGER" || c.stage === "FRIEND" || c.datedThisWeek} onClick={() => act("date")}>Go on a date<br /><span className="mut">{c.datedThisWeek ? "done this week" : "₦15,000 · 15 energy"}</span></button></div>
        <div className="row" style={{ marginTop: 8 }}>{GIFTS.map(([t, l, p]) => <button key={t} disabled={busy || c.giftedThisWeek} onClick={() => act("gift", { tier: t })}>{l}<br /><span className="mut">{c.giftedThisWeek ? "done this week" : p}</span></button>)}</div></div>
      {(c.stage === "SNEAKY" || c.stage === "DATING") && <div className="card"><b>Getting closer</b>
        <p className="mut">Adults only, and kept off-screen. There is a risk with every choice.</p>
        <div className="row"><button disabled={busy || !!d.pregnancy} onClick={() => act("safe-close")}>Be careful<br /><span className="mut">₦3,000 · lowest risk</span></button>
          <button disabled={busy || !!d.pregnancy} onClick={() => act("close")}>Just go with it<br /><span className="mut">free · higher risk</span></button></div></div>}
      <button disabled={busy} onClick={() => confirm(`End things with ${c.npcName}?`) && act("breakup")}>End the relationship</button></>}
  </>);
}
