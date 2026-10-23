"use client";
import { useCallback, useEffect, useState } from "react";
import { call, naira, notifyError } from "@/lib/client";
import { Icon } from "../Icon";
import Loader from "../Loader";
import LoadError from "../LoadError";
import "./vouchers-app.css";

const when = (value) => new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
const statusText = { active: "Open", scheduled: "Coming soon", expired: "Ended", exhausted: "Fully claimed" };

export default function VouchersApp() {
  const [data, setData] = useState(null), [failed, setFailed] = useState(false);
  const [code, setCode] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await call("/api/vouchers");
    if (r.failed) { setFailed(true); return; }
    setFailed(false); setData(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function redeem(e) {
    e.preventDefault();
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    const r = await call("/api/vouchers", { code: value, requestId: crypto.randomUUID() });
    setBusy(false);
    if (r.failed) {
      notifyError(r, "That voucher could not be redeemed.");
      if (r.status === 409 || r.status === 410) load();
      return;
    }
    setCode("");
    await load();
    (await import("@/lib/toast")).toast.success(`${naira(r.payoutKobo)} voucher reward added to your bank.`);
  }

  if (!data && !failed) return <Loader label="Checking vouchers" />;
  if (failed && !data) return <LoadError title="Vouchers could not load" onRetry={load} />;

  const open = data.vouchers.filter((v) => v.status === "active"), history = data.history;
  return (
    <div className="vc">
      <div className="vc-intro">
        <span className="vc-mark"><Icon name="gift" size={24} weight="fill" /></span>
        <div><h2>Vouchers</h2><p>Redeem a code for an in-game cash reward.</p></div>
      </div>

      <form className="vc-form" onSubmit={redeem}>
        <label htmlFor="vc-code">Voucher code</label>
        <div className="vc-entry">
          <input id="vc-code" type="text" autoComplete="off" autoCapitalize="characters" spellCheck="false" maxLength={80} placeholder="Enter your code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={busy} />
          <button type="submit" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Redeem"}</button>
        </div>
        <small>Rewards go straight to your in-game bank. Each code is first come, first served.</small>
      </form>

      <section className="vc-section" aria-labelledby="vc-open-title">
        <div className="vc-section-head"><h3 id="vc-open-title">Available rewards</h3><button type="button" onClick={load} aria-label="Refresh voucher status"><Icon name="spin" size={17} /></button></div>
        {data.vouchers.length ? <div className="vc-list">{data.vouchers.map((v) => (
          <article className="vc-card" key={v.id}>
            <div className="vc-card-head"><b>{v.label}</b><span className={`vc-status vc-${v.status}`}>{statusText[v.status] ?? v.status}</span></div>
            <strong>{naira(v.rewardKobo)} <small>per player</small></strong>
            <div className="vc-stats"><span><b>{v.remainingWinners}</b> winner spots left</span><span>Closes {when(v.endsAt)}</span></div>
            <div className="vc-progress" role="img" aria-label={`${v.remainingWinners} of ${v.maxWinners} winner spots remaining`}><i style={{ width: `${Math.max(0, Math.min(100, (v.remainingWinners / v.maxWinners) * 100))}%` }} /></div>
          </article>
        ))}</div> : <div className="vc-empty"><Icon name="gift" size={22} /><b>No active voucher drops</b><span>Check back when a new reward is announced.</span></div>}
      </section>

      <section className="vc-section" aria-labelledby="vc-history-title">
        <div className="vc-section-head"><h3 id="vc-history-title">Your redemption history</h3><span>{history.length}</span></div>
        {history.length ? <div className="vc-history">{history.map((r) => <div className="vc-history-row" key={r.id}>
          <span className="vc-history-icon"><Icon name="check" size={17} weight="bold" /></span>
          <span className="vc-history-info"><b>{r.label}</b><small>{when(r.createdAt)} · Winner #{r.ordinal}</small></span>
          <strong>+{naira(r.payoutKobo)}</strong>
        </div>)}</div> : <p className="vc-no-history">Successful claims will appear here.</p>}
      </section>
    </div>
  );
}
